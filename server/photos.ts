import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import type Database from 'better-sqlite3';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,rm,stat,realpath,readdir,rename} from 'node:fs/promises';
import {basename,dirname,extname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {defaultPhotoEdits,PHOTO_EXTENSIONS,PHOTO_FILE_LIMIT,photoEditsSchema,photoExportSchema,type Photo,type PhotoMetadata,type PhotoTask} from '../shared/photos';
import {imageEngine,inspectImage,publishImage} from './image-engine';
import {rawCall,rawThumbnail,renderPhoto} from './photo-engine';

type Row={id:string;owner:string;source:string;name:string;format:string;raw:number;bytes:number;mtime:number;managed:number;importedAt:number;metadata:string;rating:number;flag:Photo['flag'];tags:string;edits:string;revision:number};
type State={importing?:boolean;directory:string;task:PhotoTask|null;controller?:AbortController;previewController?:AbortController;preview?:Promise<unknown>;pending:Set<Promise<unknown>>;valid:()=>boolean;closed:boolean};
export function registerPhotos(app:FastifyInstance,options:{db:Database.Database;dataDir:string;rawExe:string;nativeFilesToken?:string;authorize:(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>;userId:(req:FastifyRequest)=>string|undefined;local:(req:FastifyRequest)=>boolean}) {
  const {db}=options,base=resolve(options.dataDir,'photo-library'),scratch=resolve(options.dataDir,'photo-work-'+process.pid),states=new Map<string,State>();
  db.exec(`CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,owner TEXT NOT NULL,source TEXT NOT NULL,name TEXT NOT NULL,format TEXT NOT NULL,raw INTEGER NOT NULL,bytes INTEGER NOT NULL,mtime REAL NOT NULL,managed INTEGER NOT NULL,importedAt INTEGER NOT NULL,metadata TEXT NOT NULL,rating INTEGER NOT NULL DEFAULT 0,flag TEXT NOT NULL DEFAULT 'none',tags TEXT NOT NULL DEFAULT '[]',edits TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,UNIQUE(owner,source))`);
  const ready=(async()=>{await mkdir(base,{recursive:true});await mkdir(scratch,{recursive:true});for(const e of await readdir(options.dataDir,{withFileTypes:true})){const m=/^photo-work-(\d+)$/.exec(e.name);if(!m||!e.isDirectory()||e.isSymbolicLink()||Number(m[1])===process.pid)continue;try{process.kill(Number(m[1]),0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')await rm(join(options.dataDir,e.name),{recursive:true,force:true});}}})();
  app.addHook('onReady',()=>ready);
  void ready.catch(()=>{});
  const guard=async(req:FastifyRequest,reply:FastifyReply)=>{await options.authorize(req,reply);if(!reply.sent&&!options.local(req))return reply.code(403).send({error:'照片库仅限本机使用'});};
  const nativeGuard=async(req:FastifyRequest,reply:FastifyReply)=>{await guard(req,reply);if(!reply.sent&&(!options.nativeFilesToken||req.headers['x-workbox-native-files']!==options.nativeFilesToken))return reply.code(403).send({error:'请通过本机文件选择器操作'});};
  const state=(req:FastifyRequest)=>{const owner=options.userId(req)!;let s=states.get(owner);if(!s){s={directory:join(options.dataDir,'照片导出'),task:null,pending:new Set(),valid:()=>true,closed:false};states.set(owner,s);}s.valid=()=>options.userId(req)===owner;return s;};
  const row=(owner:string,id:string)=>db.prepare('SELECT * FROM photos WHERE owner=? AND id=?').get(owner,id) as Row|undefined;
  const photo=(r:Row):Photo=>({id:r.id,name:r.name,folder:dirname(r.source),format:r.format,raw:!!r.raw,bytes:r.bytes,importedAt:r.importedAt,metadata:JSON.parse(r.metadata),rating:r.rating,flag:r.flag,tags:JSON.parse(r.tags),edits:photoEditsSchema.parse(JSON.parse(r.edits)),revision:r.revision});
  const list=(owner:string)=>(db.prepare('SELECT * FROM photos WHERE owner=? ORDER BY importedAt DESC').all(owner) as Row[]).map(photo);
  const directory=(owner:string,id:string)=>join(base,owner,id);
  const cache=(owner:string)=>join(scratch,owner);
  const live=(s:State)=>{if(s.closed||!s.valid())throw Error('操作已取消');};
  const unchanged=async(r:Row)=>{const f=await stat(r.source).catch(()=>{throw Error('原文件已移动或删除，请重新导入');});if(f.size!==r.bytes||Math.abs(f.mtimeMs-r.mtime)>1)throw Error('原文件已变化，请重新导入');};
  const friendly=(error:unknown)=>/取消/.test(String(error))?'操作已取消':/原文件|不支持|上限|超过|RAW|文件夹/.test(String(error))?String(error).replace(/^Error: /,'').slice(0,200):'处理失败，请检查图片格式和文件权限';
  async function release(owner:string){const s=states.get(owner);if(!s)return;states.delete(owner);s.closed=true;s.controller?.abort();s.previewController?.abort();await Promise.allSettled([...s.pending]);await rm(cache(owner),{recursive:true,force:true});}
  const timer=setInterval(()=>{for(const[owner,s]of states)if(!s.valid())void release(owner).catch(()=>{});},1000);timer.unref();
  app.addHook('onClose',async()=>{clearInterval(timer);await ready.catch(()=>{});await Promise.allSettled([...states.keys()].map(release));await rm(scratch,{recursive:true,force:true});});
  async function trimCache(owner:string){await ready;const dir=cache(owner);await mkdir(dir,{recursive:true});const files=await readdir(dir);const sizes=await Promise.all(files.filter(n=>n.endsWith('.tif')).map(async name=>({name,...await stat(join(dir,name))})));sizes.sort((a,b)=>b.mtimeMs-a.mtimeMs);let bytes=0;for(const f of sizes){bytes+=f.size;if(bytes>420*1024*1024)await rm(join(dir,f.name),{force:true});}}
  async function importOne(owner:string,path:string,s:State,managed=false,name?:string){
    await ready;live(s);const source=await realpath(path),format=extname(source).toLowerCase().slice(1),raw=format==='arw'||format==='dng';
    if(!PHOTO_EXTENSIONS.includes('.'+format))throw Error('不支持的图片格式');
    const f=await stat(source);if(!f.isFile()||f.size>PHOTO_FILE_LIMIT)throw Error('单张照片不能超过 256 MB');
    const existing=db.prepare('SELECT * FROM photos WHERE owner=? AND source=?').get(owner,source) as Row|undefined;
    if(existing&&existing.bytes===f.size&&Math.abs(existing.mtime-f.mtimeMs)<=1)return photo(existing);
    if(!existing&&(db.prepare('SELECT COUNT(*) AS n FROM photos WHERE owner=?').get(owner) as {n:number}).n>=5000)throw Error('照片库达到 5000 张上限');
    const id=existing?.id??randomUUID(),dir=directory(owner,id);await mkdir(dir,{recursive:true});const preview=join(dir,randomUUID()+'.jpg');
    let metadata:PhotoMetadata;
    try {
      if(raw)metadata=await rawThumbnail(options.rawExe,source,preview,s.controller!.signal).catch(async()=>{
        const m=await rawCall(options.rawExe,{action:'identify',input:source},s.controller!.signal);
        const buffer=await renderPhoto({exe:options.rawExe,source,raw:true,cache:cache(owner),edits:defaultPhotoEdits(),preview:true,signal:s.controller!.signal});await (await imageEngine())(buffer!).jpeg({quality:84}).toFile(preview);return m;
      });
      else {const sharp=await imageEngine(),bytes=await readFile(source);const m=await inspectImage(bytes);metadata={width:m.width,height:m.height};await sharp(bytes).rotate().resize({width:900,height:700,fit:'inside',withoutEnlargement:true}).jpeg({quality:84}).toFile(preview);}
      live(s);const after=await stat(source);if(after.size!==f.size||after.mtimeMs!==f.mtimeMs)throw Error('原文件在导入时发生变化，请重新导入');
      await rename(preview,join(dir,'thumb.jpg'));
      db.prepare(`INSERT INTO photos(id,owner,source,name,format,raw,bytes,mtime,managed,importedAt,metadata,edits) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,source) DO UPDATE SET bytes=excluded.bytes,mtime=excluded.mtime,metadata=excluded.metadata,edits=excluded.edits,revision=photos.revision+1`).run(id,owner,source,name??basename(source),format,raw?1:0,f.size,f.mtimeMs,managed?1:0,Date.now(),JSON.stringify(metadata),JSON.stringify(defaultPhotoEdits()));
      return photo(row(owner,id)!);
    }catch(error){await rm(preview,{force:true});if(!existing)await rm(dir,{recursive:true,force:true});throw error;}
  }
  function runTask(s:State,kind:PhotoTask['kind'],total:number,run:(task:PhotoTask,signal:AbortSignal)=>Promise<void>){
    s.previewController?.abort();s.controller=new AbortController();const signal=s.controller.signal;
    const task:PhotoTask={id:randomUUID(),kind,status:'running',total,done:0,current:'',errors:[],outputs:[]};s.task=task;
    const work=(async()=>{try{await s.preview?.catch(()=>{});await run(task,signal);task.status=signal.aborted?'cancelled':task.errors.length?task.done?'partial':'failed':'complete';}catch(error){task.status=signal.aborted||s.closed?'cancelled':'failed';if(task.status==='failed')task.errors.push(friendly(error));}})();
    s.pending.add(work);void work.finally(()=>s.pending.delete(work));return task;
  }
  app.register(async scope=>{
    scope.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:PHOTO_FILE_LIMIT},(_req,body,done)=>done(null,body));
    scope.get('/api/photos',{preHandler:guard},async req=>{await ready;const s=state(req);return {photos:list(options.userId(req)!),task:s.task,outputDirectory:s.directory,rawAvailable:existsSync(options.rawExe)};});
    scope.get('/api/photos/status',{preHandler:guard},async req=>{const s=state(req);return {task:s.task,outputDirectory:s.directory};});
    scope.post('/api/photos/import-paths',{preHandler:nativeGuard},async(req,reply)=>{
      const input=z.object({paths:z.array(z.string().min(1).max(2048)).min(1).max(500),folder:z.boolean().default(false)}).strict().parse(req.body);const s=state(req),owner=options.userId(req)!;
      if(s.importing||s.task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});
      let paths=input.paths;if(input.folder){if(paths.length!==1)return reply.code(400).send({error:'请选择一个文件夹'});const root=await realpath(paths[0]);paths=(await readdir(root,{withFileTypes:true})).filter(e=>e.isFile()&&PHOTO_EXTENSIONS.includes(extname(e.name).toLowerCase())).slice(0,501).map(e=>join(root,e.name));}
      if(paths.length>500)return reply.code(400).send({error:'单次最多导入 500 张，请分批选择'});if(!paths.length)return reply.code(400).send({error:'文件夹中没有支持的照片'});
      if(s.importing||state(req).task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});
      const task=runTask(s,'import',paths.length,async(t,signal)=>{for(const path of paths){signal.throwIfAborted();live(s);t.current=basename(path);try{await importOne(owner,path,s);t.done++;}catch(error){t.errors.push(basename(path)+'：'+friendly(error));}await trimCache(owner);}});return reply.code(202).send({task});
    });
    scope.post<{Querystring:{name:string}}>('/api/photos/upload',{preHandler:guard,bodyLimit:PHOTO_FILE_LIMIT},async(req,reply)=>{
      const s=state(req),owner=options.userId(req)!;if(s.importing||s.task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});
      const name=basename(z.string().min(1).max(240).parse(req.query.name).replace(/\\/g,'/')),ext=extname(name).toLowerCase();if(!PHOTO_EXTENSIONS.includes(ext)||!Buffer.isBuffer(req.body))return reply.code(400).send({error:'不支持此图片格式'});
      s.importing=true;s.previewController?.abort();s.controller=new AbortController();
      const operation=(async()=>{await s.preview?.catch(()=>{});await ready;live(s);const dir=join(base,owner,'imports');await mkdir(dir,{recursive:true});const source=join(dir,randomUUID()+ext);
        try{await writeFile(source,req.body as Buffer,{flag:'wx'});const result=await importOne(owner,source,s,true,name);await trimCache(owner);return result;}catch(error){await rm(source,{force:true});throw error;}
      })();s.pending.add(operation);try{return {photo:await operation};}catch(error){return reply.code(400).send({error:friendly(error)});}finally{s.pending.delete(operation);s.importing=false;}
    });
    scope.get<{Params:{id:string}}>('/api/photos/:id/thumb',{preHandler:guard},async(req,reply)=>{const owner=options.userId(req)!,r=row(owner,req.params.id);if(!r)return reply.code(404).send({error:'照片不存在'});return reply.type('image/jpeg').send(await readFile(join(directory(owner,r.id),'thumb.jpg')));});
    scope.patch<{Params:{id:string}}>('/api/photos/:id',{preHandler:guard},async(req,reply)=>{
      const input=z.object({revision:z.number().int().positive(),edits:photoEditsSchema.optional(),rating:z.number().int().min(0).max(5).optional(),flag:z.enum(['none','pick','reject']).optional(),tags:z.array(z.string().trim().min(1).max(30)).max(20).optional()}).strict().parse(req.body);
      const owner=options.userId(req)!,r=row(owner,req.params.id);if(!r)return reply.code(404).send({error:'照片不存在'});if(r.revision!==input.revision)return reply.code(409).send({error:'照片记录已更新，请重新选择后编辑'});
      db.prepare('UPDATE photos SET edits=?,rating=?,flag=?,tags=?,revision=revision+1 WHERE id=? AND owner=?').run(input.edits?JSON.stringify(input.edits):r.edits,input.rating??r.rating,input.flag??r.flag,input.tags?JSON.stringify([...new Set(input.tags)]):r.tags,r.id,owner);return {photo:photo(row(owner,r.id)!)};
    });
    scope.delete<{Params:{id:string}}>('/api/photos/:id',{preHandler:guard},async(req,reply)=>{const owner=options.userId(req)!,s=state(req),r=row(owner,req.params.id);if(!r)return reply.code(404).send({error:'照片不存在'});if(s.importing||s.task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});s.previewController?.abort();await s.preview?.catch(()=>{});db.prepare('DELETE FROM photos WHERE owner=? AND id=?').run(owner,r.id);await rm(directory(owner,r.id),{recursive:true,force:true});if(r.managed)await rm(r.source,{force:true});return {ok:true};});
    scope.post<{Params:{id:string}}>('/api/photos/:id/render',{preHandler:guard},async(req,reply)=>{
      const edits=photoEditsSchema.parse(req.body),s=state(req),owner=options.userId(req)!,r=row(owner,req.params.id);if(!r)return reply.code(404).send({error:'照片不存在'});if(s.importing||s.task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});
      s.previewController?.abort();const before=s.preview;const controller=new AbortController();s.previewController=controller;
      const disconnected=()=>{if(!reply.raw.writableEnded)controller.abort();};reply.raw.on('close',disconnected);
      const operation=(async()=>{await before?.catch(()=>{});live(s);controller.signal.throwIfAborted();await unchanged(r);await trimCache(owner);const buffer=await renderPhoto({exe:options.rawExe,source:r.source,raw:!!r.raw,cache:cache(owner),edits,preview:true,signal:controller.signal});live(s);await trimCache(owner);return buffer;})();s.preview=operation;s.pending.add(operation);
      try{const buffer=await operation;return reply.type('image/png').send(buffer);}catch(error){return reply.code(controller.signal.aborted?409:400).send({error:friendly(error)});}finally{s.pending.delete(operation);reply.raw.off('close',disconnected);}
    });
    scope.post('/api/photos/export',{preHandler:guard},async(req,reply)=>{
      const input=photoExportSchema.parse(req.body),s=state(req),owner=options.userId(req)!;if(s.importing||s.task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});const photos=input.ids.map(id=>row(owner,id));if(photos.some(r=>!r)||new Set(input.ids).size!==input.ids.length)return reply.code(400).send({error:'请选择照片库内的照片'});
      const outputDirectory=s.directory;
      const task=runTask(s,'export',photos.length,async(t,signal)=>{await mkdir(outputDirectory,{recursive:true});for(const r of photos as Row[]){signal.throwIfAborted();live(s);t.current=r.name;const temp=join(cache(owner),randomUUID()+'.export');try{await unchanged(r);await trimCache(owner);await renderPhoto({exe:options.rawExe,source:r.source,raw:!!r.raw,cache:cache(owner),edits:photoEditsSchema.parse(JSON.parse(r.edits)),preview:false,signal,output:temp,export:input});live(s);signal.throwIfAborted();const output=await publishImage(temp,outputDirectory,r.name,input.format);if(signal.aborted||s.closed){await rm(output.path,{force:true});signal.throwIfAborted();live(s);}t.outputs.push({photoId:r.id,name:output.outputName,bytes:output.outputBytes});t.done++;}catch(error){t.errors.push(r.name+'：'+friendly(error));}finally{await rm(temp,{force:true});await trimCache(owner);}}});return reply.code(202).send({task});
    });
    scope.post('/api/photos/cancel',{preHandler:guard},async req=>{const s=state(req);s.controller?.abort();s.previewController?.abort();return {ok:true};});
    scope.post('/api/photos/cache/clear',{preHandler:guard},async(req,reply)=>{const s=state(req);if(s.importing||s.task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});s.previewController?.abort();await s.preview?.catch(()=>{});await rm(cache(options.userId(req)!),{recursive:true,force:true});return {ok:true};});
    scope.post('/api/photos/output',{preHandler:nativeGuard},async(req,reply)=>{const s=state(req);if(s.importing||s.task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});const {path}=z.object({path:z.string().min(1).max(2048)}).strict().parse(req.body);const folder=await realpath(path);if(!(await stat(folder)).isDirectory())return reply.code(400).send({error:'请选择文件夹'});if(s.importing||state(req).task?.status==='running')return reply.code(409).send({error:'请等待当前任务结束'});live(s);s.directory=folder;return {ok:true};});
    scope.get<{Querystring:{id?:string}}>('/api/photos/reveal',{preHandler:nativeGuard},async(req,reply)=>{const s=state(req);if(req.query.id){const r=row(options.userId(req)!,req.query.id);if(!r)return reply.code(404).send({error:'照片不存在'});return {path:r.source,folder:false};}await mkdir(s.directory,{recursive:true});return {path:s.directory,folder:true};});
    scope.get<{Params:{id:string}}>('/api/photos/:id/recipe',{preHandler:guard},async(req,reply)=>{const r=row(options.userId(req)!,req.params.id);if(!r)return reply.code(404).send({error:'照片不存在'});return {schemaVersion:1,application:'xiaoyang-image-workshop',name:r.name,metadata:JSON.parse(r.metadata),rating:r.rating,flag:r.flag,tags:JSON.parse(r.tags),edits:JSON.parse(r.edits)};});
  });
  return {releaseOwner:release};
}
