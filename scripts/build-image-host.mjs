// Incremental build: existing workbox/network/room hosts can remain open.
import {execFileSync} from 'node:child_process';
import {existsSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {videoBuildArgs} from './video-runtime.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=join(root,'desktop-dev');
const target=join(output,'小羊图片工坊.exe');
if(existsSync(target)) {
  const backup=join(root,'runtime','image-host-before-'+Date.now());mkdirSync(backup,{recursive:true});
  copyFileSync(target,join(backup,'小羊图片工坊.exe'));
}
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/create-icons.ps1')],{stdio:'inherit'});
execFileSync(join(process.env.WINDIR??'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),[
  '/nologo','/optimize+','/platform:x64','/target:winexe',`/out:${target}`,
  ...videoBuildArgs(root),
  `/win32manifest:${join(root,'desktop/app.manifest')}`,`/win32icon:${join(root,'desktop/images.ico')}`,
  ...['System','System.Core','System.Web.Extensions','System.Windows.Forms','System.Drawing','System.IO.Compression'].map(n=>`/r:${n}.dll`),
  ...['Core','WinForms'].map(n=>`/r:${join(output,'Microsoft.Web.WebView2.'+n+'.dll')}`),
  ...['Workbox','CaptureHotkey','CaptureWindowTransition','ComputerNative','ComputerOverlay'].map(n=>join(root,'desktop',n+'.cs'))
],{stdio:'inherit'});
writeFileSync(target+'.config','<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup></configuration>');
console.log('Built: '+target);
