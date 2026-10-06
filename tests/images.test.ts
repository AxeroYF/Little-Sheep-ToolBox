import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app';
import {convertImage,inspectImage,publishImage} from '../server/image-engine';
import {imageSettingsSchema,IMAGE_FORMATS,type ImageJob} from '../shared/images';

const headers={host:'127.0.0.1:4328',origin:'http://127.0.0.1:4328'};
const png=()=>sharp({create:{width:64,height:32,channels:4,background:{r:23,g:145,b:234,alpha:0}}}).png().toBuffer();
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'workbox-images-'));await mkdir(join(root,'config'));
  await writeFile(join(root,'config/apps.json'),JSON.stringify({schemaVersion:1,apps:[]}));
  const exe=join(root,'小羊图片工坊.exe');await writeFile(exe,'test-only');
  const launches:unknown[]=[];
  const app=await createApp({root,databasePath:join(root,'test.sqlite'),dataDir:root,host:'127.0.0.1',origin:headers.origin,platform:'win32',imageExe:exe,nativeFilesToken:'native-file-picker-test',launcher:async entry=>{launches.push(entry);}});
  await app.ready();
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{username:'小羊',password:'Workbox-Local-Dev-2026!'}});
  assert.equal(login.statusCode,200);const cookie=login.cookies[0].name+'='+login.cookies[0].value;
  const request=(method:'GET'|'POST'|'DELETE',path:string,payload?:any,extra={})=>app.inject({method,url:'/api/images'+path,headers:{...headers,cookie,...extra},payload});
  const add=async(name='test.png',data?:Buffer)=>{const r=await request('POST','/import?name='+encodeURIComponent(name),data??await png(),{'content-type':'application/octet-stream'});assert.equal(r.statusCode,200,r.body);return r.json().image.id as string;};
  const wait=async()=>{for(let i=0;i<400;i++){const job=request&& (await request('GET','')).json().job as ImageJob;if(job&&job.status!=='running')return job;await new Promise(r=>setTimeout(r,25));}throw Error('Image job timeout');};
  return {root,app,cookie,request,add,wait,launches,exe,cleanup:async()=>{await app.close();await rm(root,{recursive:true,force:true});}};
}

test('all five formats decode with the expected dimensions, alpha and JPEG fill; source stays unchanged',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbox-codec-'));
  try {
    const original=await png(),source=join(dir,'source.png');await writeFile(source,original);
    for(const format of Object.keys(IMAGE_FORMATS) as (keyof typeof IMAGE_FORMATS)[]) {
      const output=join(dir,format),settings=imageSettingsSchema.parse({format,quality:100,lossless:true,background:'#ec372c'});
      await convertImage(source,output,settings,new AbortController().signal);
      const meta=await sharp(output).metadata();assert.equal(meta.width,64);assert.equal(meta.height,32);
      assert.equal(meta.format,format==='avif'?'heif':format);assert.equal(meta.exif,undefined);
      if(format==='jpeg') {
        assert.equal(meta.hasAlpha,false);const rgb=await sharp(output).raw().toBuffer();assert.ok(Math.abs(rgb[0]-236)<4&&Math.abs(rgb[1]-55)<4&&Math.abs(rgb[2]-44)<4);
      } else assert.equal(meta.hasAlpha,true);
      const inspected=await inspectImage(await readFile(output));assert.equal(inspected.width,64);assert.equal(inspected.format,format);
    }
    assert.deepEqual(await readFile(source),original);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('EXIF orientation is baked into pixels and metadata removed; existing files receive safe suffixes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'workbox-orient-'));
  try {
    const original=await sharp({create:{width:30,height:15,channels:3,background:'#4591ef'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    assert.deepEqual((({width,height})=>({width,height}))(await inspectImage(original)),{width:15,height:30});
    const source=join(dir,'照片.jpg'),output=join(dir,'converted');await writeFile(source,original);
    await convertImage(source,output,imageSettingsSchema.parse({format:'jpeg'}),new AbortController().signal);
    const meta=await sharp(output).metadata();assert.equal(meta.width,15);assert.equal(meta.height,30);assert.equal(meta.orientation,undefined);assert.equal(meta.exif,undefined);
    const first=await publishImage(output,dir,'照片.jpg','jpeg'),second=await publishImage(output,dir,'照片.jpg','jpeg');
    assert.equal(first.outputName,'照片 (2).jpg');assert.equal(second.outputName,'照片 (3).jpg');assert.deepEqual(await readFile(source),original);
    const reserved=await publishImage(output,dir,'../../CON.jpg','jpeg');assert.equal(reserved.outputName,'_CON.jpg');
    const controller=new AbortController();controller.abort();await assert.rejects(convertImage(source,join(dir,'cancelled'),imageSettingsSchema.parse({format:'png'}),controller.signal));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('static GIF works; animation, corrupt files and pixel bombs are rejected',async()=>{
  const still=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).gif().toBuffer();assert.equal((await inspectImage(still)).format,'gif');
  const frames=Buffer.alloc(4*4*2*4,255);frames.fill(0,4*4*4);
  const animated=await sharp(frames,{raw:{width:4,height:8,channels:4,pageHeight:4}}).gif().toBuffer();
  assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2);
  await assert.rejects(inspectImage(animated),/静态/);
  await assert.rejects(inspectImage(Buffer.from('broken file')));
  const large=await sharp({create:{width:6500,height:6500,channels:3,background:'#ffffff'}}).png().toBuffer();
  await assert.rejects(inspectImage(large));
});

test('image APIs enforce login, native-only directory selection, owned IDs and fixed app launch',async()=>{
  const f=await fixture();try {
    assert.equal((await f.app.inject({url:'/api/images',headers})).statusCode,401);
    assert.equal((await f.request('POST','/output',{path:f.root})).statusCode,403);
    assert.equal((await f.request('GET','/reveal')).statusCode,403);
    assert.equal((await f.request('POST','/convert',{ids:[randomUUID()],settings:{format:'png'}})).statusCode,400);
    assert.equal((await f.request('GET','/'+randomUUID()+'/preview')).statusCode,404);
    assert.equal((await f.request('POST','/import?name=broken.png',Buffer.from('broken'),{'content-type':'application/octet-stream'})).statusCode,400);
    assert.equal((await f.request('GET','')).json().images.length,0);
    const apps=(await f.app.inject({url:'/api/apps',headers:{...headers,cookie:f.cookie}})).json();assert.equal(apps.apps[0].id,'xiaoyang-images');assert.equal(apps.apps[0].installed,true);
    const launch=await f.app.inject({method:'POST',url:'/api/apps/xiaoyang-images/launch',headers:{...headers,cookie:f.cookie},payload:{}});assert.equal(launch.statusCode,200);
    assert.deepEqual(f.launches,[{type:'executable',path:f.exe,args:[`--data-dir=${f.root}`]}]);
    assert.equal((await f.app.inject({url:'/api/preferences',headers:{...headers,cookie:f.cookie}})).json().recent[0].id,'xiaoyang-images');
  } finally {await f.cleanup();}
});

test('batch conversion publishes real files, tolerates duplicate names and clears only temporary input',async()=>{
  const f=await fixture();try {
    const folder=join(f.root,'chosen');await mkdir(folder);
    assert.equal((await f.request('POST','/output',{path:folder},{'x-workbox-native-files':'native-file-picker-test'})).statusCode,200);
    const id1=await f.add('同名.png'),id2=await f.add('同名.png');
    const r=await f.request('POST','/convert',{ids:[id1,id2],settings:{format:'webp',lossless:true}});assert.equal(r.statusCode,202,r.body);
    assert.equal((await f.request('POST','/convert',{ids:[id1],settings:{format:'png'}})).statusCode,409);
    const job=await f.wait();assert.equal(job.status,'complete');assert.deepEqual(job.items.map(i=>i.outputName),['同名.webp','同名 (2).webp']);
    for(const item of job.items){const data=await readFile(join(folder,item.outputName!));assert.equal((await sharp(data).metadata()).format,'webp');assert.equal(data.length,item.outputBytes);}
    const download=await f.request('GET',`/jobs/${job.id}/${id1}/download`);assert.equal(download.statusCode,200);assert.equal(download.rawPayload.length,job.items[0].outputBytes);
    assert.equal((await f.request('GET',`/jobs/${randomUUID()}/${id1}/download`)).statusCode,404);
    assert.equal((await f.request('GET',`/reveal?job=${job.id}&image=${id1}`,undefined,{'x-workbox-native-files':'native-file-picker-test'})).json().path,join(folder,'同名.webp'));
    await f.request('DELETE','');assert.equal((await f.request('GET','')).json().images.length,0);assert.equal((await f.request('GET','')).json().outputDirectory,await (await import('node:fs/promises')).realpath(folder));
    assert.deepEqual(await readdir(join(f.root,'image-workshop-temp')),[]);assert.equal((await readdir(folder)).length,2);
  } finally {await f.cleanup();}
});

test('one damaged imported file does not stop remaining batch items',async()=>{
  const f=await fixture();try {
    const broken=await f.add('broken.png'),good=await f.add('good.png');
    const scratch=join(f.root,'image-workshop-temp',(await readdir(join(f.root,'image-workshop-temp')))[0]);await writeFile(join(scratch,broken+'.input'),'damaged');
    await f.request('POST','/convert',{ids:[broken,good],settings:{format:'png'}});const job=await f.wait();assert.equal(job.status,'partial');assert.deepEqual(job.items.map(i=>i.status),['failed','complete']);
  } finally {await f.cleanup();}
});

test('stopping prevents new outputs and logout/shutdown clean temporary files',async()=>{
  const f=await fixture();try {
    const ids=[await f.add('a.png'),await f.add('b.png')];
    await f.request('POST','/convert',{ids,settings:{format:'avif'}});await f.request('POST','/cancel',{});
    const job=await f.wait();assert.equal(job.status,'cancelled');assert.equal(job.items.filter(i=>i.status==='complete').length,0);
    assert.deepEqual(await readdir(job.outputDirectory),[]);
    assert.equal((await f.app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,cookie:f.cookie},payload:{}})).statusCode,200);
    assert.deepEqual(await readdir(join(f.root,'image-workshop-temp')),[]);assert.equal((await f.request('GET','')).statusCode,401);
  } finally {await f.cleanup();}
  const second=await fixture();try {await second.add();await second.app.close();assert.deepEqual(await readdir(join(second.root,'image-workshop-temp')),[]);}finally{await second.cleanup();}
});
