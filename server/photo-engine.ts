import {spawn} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {access,stat,rm,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {imageEngine} from './image-engine';
import {tonePixels} from '../shared/photo-tone';
import type {PhotoEdits,PhotoMetadata,PhotoExport} from '../shared/photos';

export async function rawCall(exe:string,request:Record<string,unknown>,signal:AbortSignal):Promise<PhotoMetadata> {
  signal.throwIfAborted();await access(exe);
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,[],{cwd:dirname(exe),windowsHide:true,shell:false,env:{...process.env,OMP_NUM_THREADS:'2'},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',finished=false;
    const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(error)reject(error);else {try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(Error('RAW 组件返回了无效结果'));}}};
    const abort=()=>{child.kill();};signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{stderr='RAW 处理超时';child.kill();},90000);
    child.stdout.on('data',b=>{stdout+=b.toString('utf8');if(stdout.length>65536){stderr='RAW 返回数据过大';child.kill();}});
    child.stderr.on('data',b=>{if(stderr.length<65536)stderr+=b.toString('utf8');});
    child.on('error',e=>finish(e));child.on('close',code=>finish(signal.aborted?new Error('操作已取消'):code!==0?new Error(stderr||'RAW 解码失败'):undefined));
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({...request,parentPid:process.pid})+'\n');if(signal.aborted)abort();
  });
}
export async function rawThumbnail(exe:string,input:string,destination:string,signal:AbortSignal) {
  const tmp=destination+'.'+randomUUID()+'.rawthumb';
  try {const metadata=await rawCall(exe,{action:'thumbnail',input,output:tmp},signal);const sharp=await imageEngine();
    let p=sharp(tmp,{limitInputPixels:60_000_000}).rotate();
    // Embedded previews can omit EXIF orientation. Apply LibRaw's orientation only then.
    const m=await sharp(tmp).metadata();if(!m.orientation&&metadata.flip)p=p.rotate(metadata.flip===3?180:metadata.flip===5?270:metadata.flip===6?90:0);
    await p.resize({width:900,height:700,fit:'inside',withoutEnlargement:true}).jpeg({quality:84}).timeout({seconds:20}).toFile(destination);
    return metadata;
  } finally {await rm(tmp,{force:true});}
}
export async function renderPhoto(options:{exe:string;source:string;raw:boolean;cache:string;edits:PhotoEdits;preview:boolean;signal:AbortSignal;output?:string;export?:PhotoExport}) {
  const {source,raw,cache,edits,signal}=options;signal.throwIfAborted();await mkdir(cache,{recursive:true});const sharp=await imageEngine();
  let input=source;
  if(raw){
    const fingerprint=await stat(source);
    const key=createHash('sha256').update(JSON.stringify({source,bytes:fingerprint.size,mtime:fingerprint.mtimeMs,wb:edits.whiteBalance,t:edits.temperature,tint:edits.tint,denoise:edits.denoise})).digest('hex').slice(0,20);
    input=join(cache,key+'.tif');
    try{await access(input);}catch{const temp=join(cache,key+'.'+randomUUID()+'.tif');try {await rawCall(options.exe,{action:'develop',input:source,output:temp,whiteBalance:edits.whiteBalance,temperature:edits.temperature,tint:edits.tint,denoise:edits.denoise?1:0},signal);signal.throwIfAborted();await (await import('node:fs/promises')).rename(temp,input);}finally{await rm(temp,{force:true});}}
  }
  signal.throwIfAborted();
  let pipeline=sharp(input,{limitInputPixels:60_000_000,failOn:'error'}).rotate().removeAlpha().pipelineColourspace('rgb16').toColourspace('rgb16');
  // Resample in 16-bit before tone mapping for responsive previews.
  if(options.preview)pipeline=pipeline.resize({width:1500,height:1100,fit:'inside',withoutEnlargement:true});
  else if(options.export?.longEdge){
    // Resize the source before measuring extraction coordinates. Sharp may reorder a
    // later resize ahead of rotation/extraction, invalidating full-size crop bounds.
    const metadata=await sharp(input).metadata(),width=metadata.autoOrient.width,height=metadata.autoOrient.height;
    const scale=Math.min(1,options.export.longEdge/Math.max(width*(edits.crop?.width??1),height*(edits.crop?.height??1)));
    pipeline=pipeline.resize({width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),fit:'fill',withoutEnlargement:true});
  }
  const {data,info}=await pipeline.raw({depth:'ushort'}).timeout({seconds:20}).toBuffer({resolveWithObject:true});signal.throwIfAborted();
  if(info.channels!==3)throw Error('暂不支持此图片通道布局');
  const array=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer;
  const adjusted=await new Promise<ArrayBuffer>((resolve,reject)=>{
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const run=${tonePixels.toString()};const output=run(workerData.array,workerData.linear,workerData.edits);parentPort.postMessage(output,[output]);`,{eval:true,workerData:{array,linear:raw,edits},transferList:[array]});
    let finished=false;const abort=()=>{void worker.terminate();};signal.addEventListener('abort',abort,{once:true});
    worker.once('message',value=>{finished=true;signal.removeEventListener('abort',abort);resolve(value);});worker.once('error',e=>{finished=true;signal.removeEventListener('abort',abort);reject(e);});worker.once('exit',()=>{signal.removeEventListener('abort',abort);if(!finished)reject(Error('操作已取消'));});if(signal.aborted)abort();
  });signal.throwIfAborted();
  let result=sharp(new Uint16Array(adjusted),{raw:{width:info.width,height:info.height,channels:3}}).pipelineColourspace('rgb16');
  if(edits.crop){const c=edits.crop,left=Math.min(info.width-1,Math.round(c.x*info.width)),top=Math.min(info.height-1,Math.round(c.y*info.height));result=result.extract({left,top,width:Math.max(1,Math.min(info.width-left,Math.round(c.width*info.width))),height:Math.max(1,Math.min(info.height-top,Math.round(c.height*info.height)))});}
  if(edits.flip)result=result.flop();if(edits.rotation)result=result.rotate(edits.rotation);
  if(options.preview)return result.toColourspace('srgb').png().timeout({seconds:20}).toBuffer();
  const ex=options.export!;
  result=result.toColourspace(ex.format==='tiff'&&ex.tiff16?'rgb16':'srgb').withIccProfile('srgb');
  if(ex.format==='jpeg')result=result.jpeg({quality:ex.quality});else if(ex.format==='png')result=result.png();else if(ex.format==='webp')result=result.webp({quality:ex.quality});else result=result.tiff({compression:'lzw'});
  await result.timeout({seconds:20}).toFile(options.output!);signal.throwIfAborted();return undefined;
}
