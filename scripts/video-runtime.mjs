import {copyFileSync,existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
export const videoBuildArgs=root=>['/r:System.Security.dll','/r:System.Net.Http.dll',...['VideoCore','VideoData','VideoServers','VideoNative'].map(n=>join(root,'desktop',n+'.cs'))];
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export function copyVideoRuntime(root,output){
  const packageHash='3da3f37ee2b2b10e5c788d830a3b513658c36521ea1b0f966ed86eb69f41ef3c';
  const archive=join(root,'vendor/video-download/libvlc-windows-3.0.24.nupkg');
  const source=join(root,'vendor/LibVLC-3.0.24/build/x64'),target=join(output,'components/LibVLC-3.0.24'),notice=join(output,'third-party/LibVLC-3.0.24');
  if(!existsSync(archive)||digest(archive)!==packageHash)throw Error('Prepare the pinned VideoLAN.LibVLC.Windows 3.0.24 package first');
  mkdirSync(target,{recursive:true});mkdirSync(notice,{recursive:true});
  const files=[];
  function copy(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name),rel=relative(source,path);
    if(entry.isDirectory()){if(['plugins','hrtfs'].includes(rel.split(/[\\/]/)[0]))copy(path);continue;}
    if(!/\.dll$/i.test(path)&&!rel.startsWith('hrtfs')&&!/plugins\.dat$/i.test(path))continue;
    const to=join(target,rel),sha256=digest(path);mkdirSync(join(to,'..'),{recursive:true});
    if(!existsSync(to)||digest(to)!==sha256)copyFileSync(path,to);
    files.push({path:rel,bytes:statSync(path).size,sha256});
  }}copy(source);
  const sourceArchive=join(root,'vendor/video-download/vlc-3.0.24.tar.xz');
  if(digest(sourceArchive)!=='e7cab503d1d7d5849b89d2cf0e1ee60d0ef6d012407791b644b9cfc0cc225fdf')throw Error('VLC source hash mismatch');
  if(!existsSync(join(notice,'vlc-3.0.24.tar.xz')))copyFileSync(sourceArchive,join(notice,'vlc-3.0.24.tar.xz'));
  for(const name of ['COPYING','COPYING.LIB'])copyFileSync(join(root,'vendor/video-source/vlc-3.0.24',name),join(notice,name));
  copyFileSync(join(root,'vendor/LibVLC-3.0.24/VideoLAN.LibVLC.Windows.nuspec'),join(notice,'package.nuspec'));
  for(const name of ['VideoCore','VideoData','VideoServers','VideoNative'])copyFileSync(join(root,'desktop',name+'.cs'),join(notice,name+'.cs'));
  writeFileSync(join(target,'version.json'),JSON.stringify({version:'3.0.24',package:'VideoLAN.LibVLC.Windows',packageHash,architecture:'x64',files},null,2));
  console.log('LibVLC runtime: '+files.length+' files, '+(files.reduce((s,f)=>s+f.bytes,0)/1048576).toFixed(1)+' MiB');
}
