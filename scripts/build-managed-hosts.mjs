import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,copyFileSync,renameSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {copyVideoRuntime,videoBuildArgs} from './video-runtime.mjs';
const root=resolve(import.meta.dirname,'..'),out=join(root,'desktop-dev'),stage=join(root,'runtime','native-update-'+Date.now());mkdirSync(stage,{recursive:true});
const csc=join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const base=['/nologo','/optimize+','/platform:x64','/r:System.dll','/r:System.Core.dll','/r:System.Web.Extensions.dll'];
copyVideoRuntime(root,out);
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/create-icons.ps1')],{stdio:'inherit'});
execFileSync(csc,[...base,'/target:exe','/out:'+join(stage,'AppControl.exe'),join(root,'desktop/AppControl.cs')],{stdio:'inherit'});
for(const [name,icon]of [['小羊工作箱','workbox'],['小羊网络测试','network'],['小羊房间设计','room'],['小羊图片工坊','images'],['小羊电脑信息','computer'],['小羊视频播放器','video']]){
  execFileSync(csc,[...base,'/target:winexe','/out:'+join(stage,name+'.exe'),'/win32manifest:'+join(root,'desktop/app.manifest'),'/win32icon:'+join(root,'desktop',icon+'.ico'),...['System.Windows.Forms','System.Drawing','System.IO.Compression'].map(n=>'/r:'+n+'.dll'),...['Core','WinForms'].map(n=>'/r:'+join(out,'Microsoft.Web.WebView2.'+n+'.dll')),...['Workbox','CaptureHotkey','CaptureWindowTransition','ComputerNative','ComputerOverlay'].map(n=>join(root,'desktop',n+'.cs')),...videoBuildArgs(root)],{stdio:'inherit'});
}
const backup=join(stage,'before');mkdirSync(backup);
for(const name of ['AppControl','小羊工作箱','小羊网络测试','小羊房间设计','小羊图片工坊','小羊电脑信息','小羊视频播放器']){
  const target=join(out,name+'.exe'),saved=join(backup,name+'.exe');
  // Keep backups beside the app: a live host still resolves shared resources from its original directory.
  if(existsSync(target))copyFileSync(target,saved);
  try{copyFileSync(join(stage,name+'.exe'),target);}catch(e){
    if(!['EBUSY','EPERM','EACCES'].includes(e.code))throw e;
    const old=join(out,name+'.previous-'+Date.now()+'.exe');
    renameSync(target,old);try{copyFileSync(join(stage,name+'.exe'),target);}catch(f){renameSync(old,target);throw f;}
  }
  writeFileSync(target+'.config','<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup></configuration>');
}
console.log('Updated managed native hosts; backup '+backup);
