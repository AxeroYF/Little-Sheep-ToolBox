import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
const root=resolve('runtime/video-native-'+Date.now());mkdirSync(root,{recursive:true});
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;};
const chunk=(name,data)=>Buffer.concat([Buffer.from(name),u32(data.length),data,data.length%2?Buffer.alloc(1):Buffer.alloc(0)]);
const list=(name,data)=>chunk('LIST',Buffer.concat([Buffer.from(name),data]));
const width=160,height=90,fps=10,count=150,frameBytes=width*height*3;
const avih=Buffer.alloc(56);[100000,frameBytes*fps,0,16,count,0,1,frameBytes,width,height,0,0,0,0].forEach((n,i)=>avih.writeUInt32LE(n,i*4));
const strh=Buffer.alloc(56);strh.write('vids',0);strh.write('DIB ',4);strh.writeUInt32LE(1,20);strh.writeUInt32LE(fps,24);strh.writeUInt32LE(count,32);strh.writeUInt32LE(frameBytes,36);strh.writeUInt32LE(0xffffffff,40);strh.writeInt16LE(width,52);strh.writeInt16LE(height,54);
const strf=Buffer.alloc(40);strf.writeUInt32LE(40);strf.writeInt32LE(width,4);strf.writeInt32LE(height,8);strf.writeUInt16LE(1,12);strf.writeUInt16LE(24,14);strf.writeUInt32LE(frameBytes,20);
const frames=[],indices=[];let offset=4;
for(let i=0;i<count;i++){const pixels=Buffer.alloc(frameBytes);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*3;pixels[at]=(x+i*2)%255;pixels[at+1]=y*2;pixels[at+2]=x<width/2?220:40;}const frame=chunk('00db',pixels);frames.push(frame);const idx=Buffer.alloc(16);idx.write('00db');idx.writeUInt32LE(16,4);idx.writeUInt32LE(offset,8);idx.writeUInt32LE(frameBytes,12);indices.push(idx);offset+=frame.length;}
const payload=Buffer.concat([Buffer.from('AVI '),list('hdrl',Buffer.concat([chunk('avih',avih),list('strl',Buffer.concat([chunk('strh',strh),chunk('strf',strf)]))])),list('movi',Buffer.concat(frames)),chunk('idx1',Buffer.concat(indices))]);
const media=chunk('RIFF',payload);writeFileSync(join(root,'测试视频.avi'),media);writeFileSync(join(root,'字幕.srt'),'1\n00:00:00,000 --> 00:00:14,000\n小羊播放器测试\n');
execFileSync(resolve('vendor/ShareX-21.0.0/ffmpeg.exe'),['-hide_banner','-loglevel','error','-i',join(root,'测试视频.avi'),'-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','12','-c:v','libx264','-pix_fmt','yuv420p','-g','20','-c:a','aac','-hls_time','2','-hls_playlist_type','vod','-hls_segment_filename',join(root,'seg%02d.ts'),join(root,'master.m3u8')],{windowsHide:true});
const requests=[];let authenticatedMedia=0,ranges=0;
const server=createServer(async(req,res)=>{
  try{let body='';for await(const b of req)body+=b;const url=new URL(req.url,'http://localhost'),path=url.pathname.replace(/^\/(jellyfin|reverse\/emby)\//,'/');
    requests.push({path,method:req.method});
    if(path==='/Users/AuthenticateByName'){assert.equal(JSON.parse(body).Pw,'test-password');assert.match(req.headers['x-emby-authorization'],/Xiaoyang Video/);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({User:{Id:'user1'},AccessToken:'testtoken'}));return;}
    if(path.endsWith('/master.m3u8')){assert.equal(url.searchParams.get('api_key'),'testtoken');res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end(readFileSync(join(root,'master.m3u8'),'utf8').replace(/seg\d+\.ts/g,m=>m+'?api_key=testtoken'));return;}
    if(/\/seg\d+\.ts$/.test(path)){assert.equal(url.searchParams.get('api_key'),'testtoken');res.setHeader('Content-Type','video/mp2t');res.end(readFileSync(join(root,path.split('/').at(-1))));return;}
    if(path.startsWith('/Videos/')){assert.equal(url.searchParams.get('api_key'),'testtoken');authenticatedMedia++;let from=0,to=media.length-1;if(req.headers.range){const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range);if(m){from=Number(m[1]);to=m[2]?Number(m[2]):to;ranges++;res.statusCode=206;res.setHeader('Content-Range',`bytes ${from}-${to}/${media.length}`);}}res.setHeader('Content-Type','video/x-msvideo');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',to-from+1);res.end(req.method==='HEAD'?undefined:media.subarray(from,to+1));return;}
    assert.equal(req.headers['x-emby-token'],'testtoken');res.setHeader('Content-Type','application/json');
    if(path==='/Users/user1/Views')res.end(JSON.stringify({Items:[{Id:'library1',Name:'电影',Type:'CollectionFolder',IsFolder:true}],TotalRecordCount:1}));
    else if(path==='/Users/user1/Items')res.end(JSON.stringify({Items:[{Id:'movie1',Name:'测试影片',Type:'Movie',RunTimeTicks:150000000},{Id:'series1',Name:'测试剧集',Type:'Series',IsFolder:true}],TotalRecordCount:2}));
    else if(path==='/Users/user1/Items/movie1')res.end(JSON.stringify({UserData:{PlaybackPositionTicks:20000000}}));
    else if(path==='/Items/movie1/PlaybackInfo')res.end(JSON.stringify({MediaSources:[{Id:'source1',SupportsDirectPlay:true,TranscodingUrl:'/Videos/movie1/master.m3u8?MediaSourceId=source1'}],PlaySessionId:'session1'}));
    else if(path.startsWith('/Sessions/Playing')){assert.equal(JSON.parse(body).ItemId,'movie1');res.end('{}');}else{res.statusCode=404;res.end('{}');}
  }catch(e){res.statusCode=500;res.end('{}');requests.push({error:String(e)});}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{
 const exe=join(root,'VideoTests.exe');execFileSync(join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/platform:x64','/target:exe','/out:'+exe,...['System','System.Core','System.Web.Extensions','System.Security','System.Net.Http','System.Windows.Forms','System.Drawing'].map(n=>'/r:'+n+'.dll'),...['VideoCore','VideoData','VideoServers'].map(n=>resolve('desktop',n+'.cs')),resolve('tests/VideoTests.cs')],{stdio:'inherit'});
 const child=spawn(exe,[root,resolve('desktop-dev/components/LibVLC-3.0.24'),origin],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>{output+=b;process.stdout.write(b)});child.stderr.on('data',b=>{output+=b;process.stderr.write(b)});const timer=setTimeout(()=>child.kill(),60000);const code=await new Promise(r=>child.on('exit',r));clearTimeout(timer);writeFileSync(join(root,'output.txt'),output);assert.equal(code,0);assert.ok(authenticatedMedia>0);assert.ok(ranges>0);assert.ok(!requests.some(r=>r.error));assert.ok(requests.some(r=>r.path==='/Sessions/Playing/Stopped'));assert.ok(existsSync(join(root,'frame.png')));writeFileSync(join(root,'results.json'),JSON.stringify({passed:true,authenticatedMedia,ranges,requests},null,2));console.log('Native video report: '+root);
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
