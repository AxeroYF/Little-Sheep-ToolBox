import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/app';
const run=resolve('runtime/video-ui-'+Date.now());mkdirSync(run,{recursive:true});
const origin='http://127.0.0.1:4338',app=await createApp({root:process.cwd(),databasePath:join(run,'test.sqlite'),dataDir:run,host:'127.0.0.1',origin,platform:'win32',launcher:async()=>{}});
await app.listen({host:'127.0.0.1',port:4338});const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1104,height:681}});const errors:string[]=[],checks:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
try{
 await page.addInitScript({content:'window.__name = (fn) => fn;'});
 await page.addInitScript(()=>{
  const w=window as any,listeners=new Set<(e:any)=>void>(),commands:any[]=[];w.videoCommands=commands;
  const library={available:true,items:[],servers:[]} as any;let full=false;
  const send=(m:any)=>listeners.forEach(f=>f({data:JSON.parse(JSON.stringify(m))}));
  const state={state:'playing',time:65000,duration:5400000,seekable:true,volume:70,rate:1,width:1920,height:1080,fps:24,audio:1,subtitle:-1,audioTracks:[{id:1,name:'中文'}],subtitleTracks:[{id:-1,name:'关闭'},{id:2,name:'简体中文'}]};
  w.chrome={webview:{addEventListener:(_:string,f:any)=>listeners.add(f),removeEventListener:(_:string,f:any)=>listeners.delete(f),postMessage:(m:any)=>{
    commands.push(m);if(!m.action.startsWith('video-')||m.action==='video-rect')return;
    setTimeout(()=>{let data:any=null;
     if(m.action==='video-init')data=library;
     if(m.action==='video-files'){library.items=[{id:'local1',name:'窗边的旅行.mp4',kind:'local',position:65000,duration:5400000,detail:'D:\\视频'}];data=library;send({type:'video-library',data:library});send({type:'video-state',id:'local1',data:state,fullscreen:full,pinned:false});}
     if(m.action==='video-connect'){library.servers=[{id:'server1',name:'家庭影院',kind:m.kind,address:m.url,user:m.username}];data='server1';send({type:'video-library',data:library});}
     if(m.action==='video-browse')data={total:m.parent?2:1,items:m.parent?[{id:'movie1',name:'测试影片',type:'Movie',folder:false,duration:7200000,position:120000,year:2025},{id:'series1',name:'测试剧集',type:'Series',folder:true}]:[{id:'library1',name:'电影',type:'CollectionFolder',folder:true}]};
     if(m.action==='video-pause'){state.state=m.paused?'paused':'playing';send({type:'video-state',id:'local1',data:state,fullscreen:full,pinned:false});}
     if(m.action==='video-fullscreen'){full=!full;send({type:'video-window',fullscreen:full,pinned:false});}
     if(m.action==='video-capture')send({type:'video-notice',message:'已保存到工作箱截图管理'});
     send({type:'video-response',requestId:m.requestId,data});
    },10);
  }}};
 });
 await page.goto(origin+'/?window=video');assert.equal(await page.locator('.video-app').count(),0);
 await page.getByLabel('密码',{exact:true}).fill('Workbox-Local-Dev-2026!');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'打开视频',exact:true}).waitFor();await page.waitForFunction(()=>!(document.querySelector('.video-toolbar .primary') as HTMLButtonElement).disabled);checks.push('login boundary');
 const overflow=()=>page.evaluate(()=>({x:document.documentElement.scrollWidth-innerWidth,y:document.documentElement.scrollHeight-innerHeight}));
 await page.getByRole('button',{name:'浅色',exact:true}).click();assert.deepEqual(await overflow(),{x:0,y:0});await page.screenshot({path:join(run,'light-empty.png')});
 await page.getByRole('button',{name:'打开视频',exact:true}).click();await page.getByRole('button',{name:'暂停',exact:true}).waitFor();await page.getByRole('button',{name:'暂停',exact:true}).click();await page.getByRole('button',{name:'播放',exact:true}).waitFor();await page.getByRole('button',{name:'播放',exact:true}).click();checks.push('native file open and playback controls bridge');
 await page.getByRole('button',{name:'全屏',exact:true}).click();await page.getByRole('button',{name:'退出全屏',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('button',{name:'全屏',exact:true}).waitFor();checks.push('fullscreen Escape from focused button');
 await page.getByRole('button',{name:'深色',exact:true}).click();await page.screenshot({path:join(run,'dark-player.png')});
 await page.getByRole('button',{name:'连接服务器',exact:true}).click();await page.getByRole('dialog').waitFor();await page.waitForFunction(()=>{const commands=(window as any).videoCommands;return commands.filter((m:any)=>m.action==='video-rect').at(-1)?.visible===false;});assert.deepEqual(await overflow(),{x:0,y:0});await page.screenshot({path:join(run,'server-dialog.png')});
 await page.getByLabel('服务器地址',{exact:true}).fill('https://example.test/jellyfin');await page.getByLabel('用户名',{exact:true}).fill('viewer');await page.getByLabel('密码',{exact:true}).fill('test-only');await page.getByRole('button',{name:'连接',exact:true}).click();await page.getByRole('button',{name:'电影 媒体库'}).click();await page.getByRole('button',{name:/测试影片/}).waitFor();await page.screenshot({path:join(run,'dark-library.png')});
 await page.getByLabel('服务器播放方式').selectOption('transcode');await page.getByRole('button',{name:/测试影片/}).click();await page.waitForFunction(()=>(window as any).videoCommands.some((m:any)=>m.action==='video-server-play'&&m.transcode&&m.itemId==='movie1'));checks.push('server login, folders, transcode command and hidden HWND during dialog');
 await page.getByRole('button',{name:'保存当前画面',exact:true}).click();await page.getByText('已保存到工作箱截图管理',{exact:true}).waitFor();
 await page.getByRole('button',{name:'播放链接',exact:true}).click();await page.getByLabel('播放地址').fill('https://example.test/master.m3u8');await page.getByText('连接选项',{exact:true}).click();assert.deepEqual(await overflow(),{x:0,y:0});await page.screenshot({path:join(run,'link-dialog.png')});await page.getByRole('button',{name:'关闭弹窗'}).click();
 await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('button',{name:'登录',exact:true}).waitFor();assert.equal(await page.locator('.video-app').count(),0);checks.push('logout unmounts player');assert.deepEqual(errors,[]);
 writeFileSync(join(run,'results.json'),JSON.stringify({checks,errors,minimumViewport:'1104×681',bridge:'deterministic fixture; decoding covered separately by native-video'},null,2));console.log('Video UI passed: '+run);
}catch(e){await page.screenshot({path:join(run,'failure.png')});writeFileSync(join(run,'failure.json'),JSON.stringify({errors,text:await page.locator('body').innerText(),commands:await page.evaluate(()=>(window as any).videoCommands)},null,2));console.log(run);throw e;}finally{await browser.close();await app.close();}
