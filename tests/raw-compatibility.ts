// Read-only compatibility verification. All derivatives stay in the test directory.
import {readdir,readFile,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {resolve,join,extname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {rawCall,renderPhoto} from '../server/photo-engine';
import {defaultPhotoEdits} from '../shared/photos';
const root=process.argv[2],run=resolve('runtime','raw-compatibility-'+Date.now());
if(!root)throw new Error('Usage: tsx tests/raw-compatibility.ts <folder-containing-RAW-samples>');
await mkdir(run,{recursive:true});const exe=resolve('desktop-dev/components/LibRaw-0.22.2/RawPhoto.exe');
const results=[];
for(const name of (await readdir(root)).filter(n=>['.arw','.dng'].includes(extname(n).toLowerCase()))){
  const source=join(root,name),before=await stat(source),hash=async()=>createHash('sha256').update(await readFile(source)).digest('hex'),digest=await hash();
  const start=Date.now();let result;
  try{
    const signal=new AbortController().signal,metadata=await rawCall(exe,{action:'identify',input:source},signal);
    const buffer=await renderPhoto({exe,source,raw:true,cache:join(run,'cache'),edits:defaultPhotoEdits(),preview:true,signal});
    const dimensions=await sharp(buffer).metadata();assert.ok(dimensions.width!>500&&dimensions.height!>500);
    await writeFile(join(run,basename(name)+'.png'),buffer!);result={name,metadata,preview:{width:dimensions.width,height:dimensions.height},ms:Date.now()-start};
  }catch(error){result={name,error:String(error)};}
  assert.equal(await hash(),digest);assert.equal((await stat(source)).mtimeMs,before.mtimeMs);
  results.push({...result,originalUnchanged:true});console.log(JSON.stringify(result));await rm(join(run,'cache'),{recursive:true,force:true});
}
await writeFile(join(run,'results.json'),JSON.stringify(results,null,2));console.log(run);
assert.ok(results.length>0);assert.equal(results.filter(r=>'error'in r).length,0);
