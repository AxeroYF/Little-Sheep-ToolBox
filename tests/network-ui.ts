import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdirSync,writeFileSync,readdirSync,statSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server/app';
import {speedNodes} from '../server/speed';
import type {NetworkJob} from '../shared/network';

const run=resolve('runtime','network-timed-ui-'+Date.now());mkdirSync(run,{recursive:true});
let activeDownloads=0,overlap=false;const requestHeaders:string[]=[];
// Real streamed loopback traffic: no Internet bandwidth, fake jobs or generated chart values.
const block=Buffer.alloc(65536,0x51);
const nodeServer=createServer((req,res)=>{
  requestHeaders.push(String(req.headers['cache-control']));
  if(req.method==='POST'){
    if(activeDownloads)overlap=true;
    req.on('data',()=>{req.pause();setTimeout(()=>req.resume(),10);});req.on('end',()=>res.end());return;
  }
  activeDownloads++;
  let remaining=Number(new URL(req.url!,'http://localhost').searchParams.get('ckSize'))*1048576;
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':remaining});
  const timer=setInterval(()=>{
    const n=Math.min(remaining,32768+Math.floor((Math.sin(Date.now()/1700)+1)*16000));
    res.write(block.subarray(0,n));remaining-=n;if(!remaining){clearInterval(timer);res.end();}
  },12);
  res.once('close',()=>{clearInterval(timer);activeDownloads--;});
});
nodeServer.listen(0,'127.0.0.1');await once(nodeServer,'listening');
const savedNodes=[...speedNodes];
speedNodes.splice(0,speedNodes.length,{...savedNodes[0],name:'本地验证节点',host:'127.0.0.1',region:'回环流量 · 验证用',base:`http://127.0.0.1:${(nodeServer.address() as {port:number}).port}/`});
const origin='http://127.0.0.1:4332';
const app=await createApp({root:process.cwd(),databasePath:resolve(run,'test.sqlite'),host:'127.0.0.1',origin,platform:'win32',launcher:async()=>{},logger:false});
await app.listen({host:'127.0.0.1',port:4332});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
const errors:string[]=[],checks:string[]=[];
try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:860}});
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(origin+'/?window=network');await page.getByLabel('密码',{exact:true}).fill('Workbox-Local-Dev-2026!');await page.getByRole('button',{name:'登录',exact:true}).click();
  const start=page.getByRole('button',{name:'开始测试',exact:true});await start.waitFor();
  const download=page.getByRole('region',{name:'下载速度'}),upload=page.getByRole('region',{name:'上传速度'});
  const waitUntil=async(check:()=>Promise<boolean>,timeout=35000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await page.waitForTimeout(100);}throw Error('UI condition did not settle');};
  await waitUntil(async()=>await start.isEnabled());
  assert.equal(await page.getByRole('button',{name:'快速',exact:true}).count(),0);
  const downBox=await download.boundingBox(),upBox=await upload.boundingBox();assert.ok(downBox&&upBox);assert.equal(downBox.y,upBox.y);assert.ok(upBox.x>downBox.x);const iconBox=await download.locator('.speed-card-heading svg').boundingBox();assert.ok(iconBox&&iconBox.width<=24&&iconBox.height<=24);
  const begin=Date.now();await start.click();
  await waitUntil(async()=>(await download.locator('.speed-sample').count())>=3,7000);
  assert.equal(await upload.locator('.speed-sample').count(),0);assert.match(await upload.innerText(),/等待下载完成/);
  await page.screenshot({path:resolve(run,'download-running.png'),fullPage:true});
  await waitUntil(async()=>(await upload.locator('.speed-sample').count())>=2,20000);
  assert.match(await download.innerText(),/完成/);assert.match(await upload.innerText(),/测试中/);
  assert.ok(Date.now()-begin>=16000);
  await page.screenshot({path:resolve(run,'upload-running.png'),fullPage:true});
  await waitUntil(async()=>await start.isVisible(),20000);assert.ok(Date.now()-begin>=30000);
  const historyResponse=await page.request.get(origin+'/api/network/history');assert.equal(historyResponse.headers()['cache-control'],'no-store');
  const report=(await historyResponse.json()).reports[0] as NetworkJob;
  assert.equal(report.status,'complete');assert.equal(report.result.phaseDurationMs,15000);assert.equal(report.result.downloadDurationMs,15000);assert.equal(report.result.uploadDurationMs,15000);
  const samples=report.result.speedSamples!;
  for(const direction of ['download','upload'] as const){
    const measured=samples.filter(s=>s.direction===direction&&s.phaseElapsedMs!>0);
    assert.equal(measured.length,15);assert.equal(measured.at(-1)?.phaseElapsedMs,15000);
    const peak=direction==='download'?report.result.downloadPeakMbps:report.result.uploadPeakMbps;assert.equal(peak,Math.max(...measured.map(s=>s.mbps)));
    const panel=direction==='download'?download:upload;assert.equal(await panel.locator('.speed-sample').count(),15);assert.ok(!(await panel.locator('.speed-peak strong').innerText()).includes('—'));assert.equal(await panel.locator('.speed-point-value').count(),0);assert.match((await panel.locator('.speed-line').getAttribute('d'))!,/ C/);const point=panel.locator('.speed-sample').nth(5);await point.hover();await waitUntil(async()=>(await panel.locator('.speed-chart-readout').innerText()).includes(measured[5].mbps.toLocaleString(undefined,{maximumFractionDigits:2})+' Mbps'));await page.mouse.move(5,5);
  }
  assert.equal(overlap,false);assert.ok(requestHeaders.every(h=>h==='no-store'));
  checks.push('separate columns; actual download 15 seconds then upload 15 seconds; 15 samples per direction, smooth curves without persistent labels, and recorded peaks; no overlap');
  await page.screenshot({path:resolve(run,'result-light.png'),fullPage:true});
  await page.getByRole('button',{name:'深色',exact:true}).click();await waitUntil(async()=>await page.getByRole('button',{name:'深色',exact:true}).getAttribute('aria-pressed')==='true');await page.waitForTimeout(180);
  await page.screenshot({path:resolve(run,'result-dark.png'),fullPage:true});
  const [downloadPeak,uploadPeak]=await Promise.all([download.locator('.speed-peak strong').innerText(),upload.locator('.speed-peak strong').innerText()]);
  await page.reload();await page.getByRole('button',{name:'历史记录',exact:true}).click();await page.getByRole('button',{name:'完成',exact:true}).click();
  assert.equal(await download.locator('.speed-peak strong').innerText(),downloadPeak);assert.equal(await upload.locator('.speed-peak strong').innerText(),uploadPeak);assert.equal(await download.locator('.speed-sample').count(),15);
  checks.push('history restores both curves, duration and saved maxima; light/dark visual checks');
  await page.setViewportSize({width:1120,height:720});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await start.click();await waitUntil(async()=>await download.locator('.speed-sample').count()>=1,5000);await page.getByRole('button',{name:'停止',exact:true}).click();await waitUntil(async()=>await start.isVisible(),5000);
  assert.match(await download.innerText(),/已停止/);assert.equal(await upload.locator('.speed-sample').count(),0);
  checks.push('minimum window, stop during download never starts upload');
  assert.deepEqual(errors,[]);
  // Only lightweight report/session data is written; streamed test bodies have no files.
  const files=readdirSync(run);assert.ok(files.every(name=>/\.png$|^test\.sqlite(?:-wal|-shm)?$/.test(name)));
  assert.ok(files.filter(name=>name.startsWith('test.sqlite')).reduce((n,name)=>n+statSync(resolve(run,name)).size,0)<1048576);
  writeFileSync(resolve(run,'results.json'),JSON.stringify({checks,report,errors,rawTrafficFiles:0},null,2));
  console.log(JSON.stringify({run,checks,errors}));
}finally{
  await browser?.close();await app.close();speedNodes.splice(0,speedNodes.length,...savedNodes);
  nodeServer.closeAllConnections();await new Promise<void>(done=>nodeServer.close(()=>done()));
  for(const suffix of ['','-wal','-shm'])rmSync(resolve(run,'test.sqlite'+suffix),{force:true});
}
