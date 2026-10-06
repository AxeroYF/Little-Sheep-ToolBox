import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,readdirSync,readFileSync,existsSync,unlinkSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {videoBuildArgs} from '../scripts/video-runtime.mjs';
const root=process.cwd(),out=resolve('desktop-dev'),run=resolve('runtime/video-host-'+Date.now());mkdirSync(run,{recursive:true});
const fixture=readdirSync('runtime').filter(n=>n.startsWith('video-native-')).sort().at(-1);assert.ok(fixture);const media=readFileSync(join('runtime',fixture,'测试视频.avi'));
const server=createServer((req,res)=>{let from=0,to=media.length-1;const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range??'');if(m){from=Number(m[1]);to=m[2]?Number(m[2]):to;res.statusCode=206;res.setHeader('Content-Range',`bytes ${from}-${to}/${media.length}`);}res.setHeader('Content-Type','video/x-msvideo');res.setHeader('Content-Length',to-from+1);res.setHeader('Accept-Ranges','bytes');res.end(req.method==='HEAD'?undefined:media.subarray(from,to+1));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const exe=join(out,'VideoHostSmoke.exe');
writeFileSync(exe+'.config','<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup></configuration>');
try{
 execFileSync(join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/platform:x64','/target:winexe','/main:VideoHostSmoke','/out:'+exe,...['System','System.Core','System.Web.Extensions','System.Windows.Forms','System.Drawing','System.IO.Compression'].map(n=>'/r:'+n+'.dll'),...['Core','WinForms'].map(n=>'/r:'+join(out,'Microsoft.Web.WebView2.'+n+'.dll')),...['Workbox','CaptureHotkey','CaptureWindowTransition','ComputerNative','ComputerOverlay'].map(n=>resolve('desktop',n+'.cs')),...videoBuildArgs(root),resolve('tests/VideoHostSmoke.cs')],{stdio:'inherit'});
 const child=spawn(exe,[run,'http://127.0.0.1:'+server.address().port+'/clip.avi'],{windowsHide:true,stdio:'ignore',env:{...process.env,WORKBOX_INITIAL_PASSWORD:'Workbox-Local-Dev-2026!'}}),timer=setTimeout(()=>child.kill(),90000);const code=await new Promise(r=>child.on('exit',r));clearTimeout(timer);if(existsSync(join(run,'host-tests.txt')))console.log(readFileSync(join(run,'host-tests.txt'),'utf8'));if(existsSync(join(run,'host-failure.txt')))console.log(readFileSync(join(run,'host-failure.txt'),'utf8'));assert.equal(code,0);assert.ok(existsSync(join(run,'host-passed.txt')));console.log('Native desktop integration: '+run);
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(existsSync(exe))unlinkSync(exe);if(existsSync(exe+'.config'))unlinkSync(exe+'.config');}
