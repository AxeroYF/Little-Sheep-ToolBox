import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app';
import {defaultPhotoEdits,photoEditsSchema,type PhotoTask} from '../shared/photos';
import {tonePixels} from '../shared/photo-tone';
import {renderPhoto,rawCall} from '../server/photo-engine';
const headers={host:'127.0.0.1:4328',origin:'http://127.0.0.1:4328'},native={'x-workbox-native-files':'photo-picker-test'};
const rawExe=resolve('desktop-dev/components/LibRaw-0.22.2/RawPhoto.exe'),rawSample=resolve('runtime/raw-fixtures/a7cii-compressed.ARW');
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'workbox-photos-'));await mkdir(join(root,'config'));await writeFile(join(root,'config/apps.json'),JSON.stringify({schemaVersion:1,apps:[]}));
  const app=await createApp({root,dataDir:root,databasePath:join(root,'test.sqlite'),host:'127.0.0.1',origin:headers.origin,platform:'win32',rawExe,nativeFilesToken:native['x-workbox-native-files']});await app.ready();
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{username:'小羊',password:'Workbox-Local-Dev-2026!'}});assert.equal(login.statusCode,200);const cookie=login.cookies[0].name+'='+login.cookies[0].value;
  const request=(method:'GET'|'POST'|'PATCH'|'DELETE',url:string,payload?:any,extra={})=>app.inject({method,url:'/api/photos'+url,headers:{...headers,cookie,...extra},payload});
  const wait=async()=>{for(let i=0;i<600;i++){const task=(await request('GET','/status')).json().task as PhotoTask;if(task&&task.status!=='running')return task;await new Promise(r=>setTimeout(r,25));}throw Error('Task timeout');};
  const add=async(path:string)=>{const r=await request('POST','/import-paths',{paths:[path]},native);assert.equal(r.statusCode,202,r.body);const t=await wait();assert.equal(t.status,'complete',JSON.stringify(t));return (await request('GET','')).json().photos[0];};
  const source=join(root,'原片.jpg');await sharp({create:{width:96,height:64,channels:3,background:'#738dca'}}).jpeg().toFile(source);
  return{root,app,cookie,request,wait,add,source,cleanup:async()=>{await app.close();await rm(root,{recursive:true,force:true});}};
}
test('tone mapping keeps unedited sRGB and maps linear mid-gray to expected sRGB; schemas reject unsafe edits',()=>{
  const pixels=new Uint16Array([0,18000,65535,500,32000,60000]);const original=pixels.slice();tonePixels(pixels.buffer,false,defaultPhotoEdits());for(let i=0;i<pixels.length;i++)assert.ok(Math.abs(pixels[i]-original[i])<=1);
  const linear=new Uint16Array([Math.round(.18*65535),Math.round(.18*65535),Math.round(.18*65535)]);tonePixels(linear.buffer,true,defaultPhotoEdits());assert.ok(Math.abs(linear[0]/65535-.46136)<.001);
  assert.equal(photoEditsSchema.safeParse({crop:{x:.9,y:0,width:.5,height:1}}).success,false);assert.equal(photoEditsSchema.safeParse({source:'C:/secret'}).success,false);
});
test('photo library requires login and native path capability; duplicate import references originals; remove never deletes them',async()=>{
  const f=await fixture();try{
    assert.equal((await f.app.inject({url:'/api/photos',headers})).statusCode,401);
    assert.equal((await f.request('POST','/import-paths',{paths:[f.source]})).statusCode,403);
    assert.equal((await f.request('POST','/output',{path:f.root})).statusCode,403);
    const original=await readFile(f.source),p=await f.add(f.source);assert.equal((await f.add(f.source)).id,p.id);
    assert.equal((await f.request('GET','')).json().photos.length,1);
    assert.equal((await f.request('GET','/'+p.id+'/thumb')).headers['content-type'],'image/jpeg');
    assert.equal((await f.request('GET','/reveal?id='+p.id,undefined,native)).json().path,f.source);
    assert.equal((await f.request('DELETE','/'+p.id)).statusCode,200);assert.deepEqual(await readFile(f.source),original);
  }finally{await f.cleanup();}
});
test('edits, rating and tags use revisions; export uses saved crop, rotation and 16-bit TIFF; originals unchanged',async()=>{
  const f=await fixture();try{
    const before=await readFile(f.source),p=await f.add(f.source),edits={...defaultPhotoEdits(),exposure:1,rotation:90,crop:{x:0,y:0,width:.5,height:1}};
    const patch=await f.request('PATCH','/'+p.id,{revision:p.revision,edits,rating:4,flag:'pick',tags:['鸟','鸟']});assert.equal(patch.statusCode,200,patch.body);
    assert.equal((await f.request('PATCH','/'+p.id,{revision:p.revision,rating:1})).statusCode,409);
    const recipe=(await f.request('GET','/'+p.id+'/recipe')).json();assert.equal(recipe.edits.exposure,1);assert.deepEqual(recipe.tags,['鸟']);
    const render=await f.request('POST','/'+p.id+'/render',edits);assert.equal(render.statusCode,200,render.headers['content-type']);const pm=await sharp(render.rawPayload).metadata();assert.equal(pm.width,64);assert.equal(pm.height,48);
    assert.equal((await f.request('POST','/export',{ids:[p.id],format:'tiff'})).statusCode,202);assert.equal((await f.wait()).status,'complete');
    const out=join(f.root,'照片导出','原片.tif'),meta=await sharp(out).metadata();assert.equal(meta.width,64);assert.equal(meta.height,48);assert.equal(meta.depth,'ushort');assert.ok(meta.icc);assert.equal(meta.exif,undefined);
    await f.request('POST','/export',{ids:[p.id],format:'jpeg',longEdge:32});assert.equal((await f.wait()).status,'complete');const sized=await sharp(join(f.root,'照片导出','原片.jpg')).metadata();assert.equal(sized.width,32);assert.equal(sized.height,24);
    await f.request('POST','/export',{ids:[p.id],format:'tiff'});await f.wait();assert.ok(existsSync(join(f.root,'照片导出','原片 (2).tif')));
    assert.deepEqual(await readFile(f.source),before);
    await f.app.inject({method:'POST',url:'/api/auth/logout',headers:{...headers,cookie:f.cookie},payload:{}});
    assert.deepEqual(await readdir(join(f.root,'photo-work-'+process.pid)),[]);assert.ok(existsSync(out));
    const login=await f.app.inject({method:'POST',url:'/api/auth/login',headers,payload:{username:'小羊',password:'Workbox-Local-Dev-2026!'}});const cookie=login.cookies[0].name+'='+login.cookies[0].value;
    const restored=(await f.app.inject({url:'/api/photos',headers:{...headers,cookie}})).json().photos[0];assert.equal(restored.rating,4);assert.equal(restored.edits.exposure,1);
  }finally{await f.cleanup();}
});
test('changed/missing originals produce actionable errors and can be reimported; managed uploads are removed separately',async()=>{
  const f=await fixture();try{
    const p=await f.add(f.source);await sharp({create:{width:90,height:50,channels:3,background:'red'}}).jpeg().toFile(f.source);
    const render=await f.request('POST','/'+p.id+'/render',{});assert.equal(render.statusCode,400);assert.match(render.json().error,/变化/);
    const reimport=await f.add(f.source);assert.equal(reimport.id,p.id);assert.equal(reimport.metadata.width,90);
    const uploaded=await f.request('POST','/upload?name=copy.jpg',await readFile(f.source),{'content-type':'application/octet-stream'});assert.equal(uploaded.statusCode,200,uploaded.body);
    const managed=uploaded.json().photo;const copied=(await f.request('GET','/reveal?id='+managed.id,undefined,native)).json().path;assert.notEqual(copied,f.source);assert.ok(existsSync(copied));
    await f.request('DELETE','/'+managed.id);assert.equal(existsSync(copied),false);assert.ok(existsSync(f.source));
  }finally{await f.cleanup();}
});
test('actual A7C II RAW import, render, cache cleanup and cancellation leave original untouched',{skip:!existsSync(rawSample)||!existsSync(rawExe)},async()=>{
  const f=await fixture();try{
    const before=await stat(rawSample),p=await f.add(rawSample);assert.equal(p.metadata.camera,'ILCE-7CM2');assert.equal(p.raw,true);
    const response=await f.request('POST','/'+p.id+'/render',defaultPhotoEdits());assert.equal(response.statusCode,200,response.headers['content-type']);assert.equal((await sharp(response.rawPayload).metadata()).width,1500);
    const cache=join(f.root,'photo-work-'+process.pid);assert.ok((await readdir(cache,{recursive:true})).some(n=>n.endsWith('.tif')));
    await f.request('POST','/cache/clear',{});assert.deepEqual(await readdir(cache),[]);
    await f.request('POST','/export',{ids:[p.id],format:'jpeg'});assert.equal((await f.request('POST','/export',{ids:[p.id],format:'jpeg'})).statusCode,409);
    await f.request('POST','/cancel',{});assert.equal((await f.wait()).status,'cancelled');assert.deepEqual(await readdir(join(f.root,'照片导出')),[]);
    assert.equal((await stat(rawSample)).mtimeMs,before.mtimeMs);assert.equal((await stat(rawSample)).size,before.size);
    const controller=new AbortController();controller.abort();await assert.rejects(rawCall(rawExe,{action:'identify',input:rawSample},controller.signal));
  }finally{await f.cleanup();}
});
