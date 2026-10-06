import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { transfer, runSpeed, speedUrl, speedNodes, type SpeedEndpoint } from "../server/speed";
import { parsePublicRoute, proxyAssessment } from "../server/network-info";
import type { LocalNetworkInfo, NetworkJob } from "../shared/network";
import { parseNetworkTarget, NETWORK_TARGET_ERROR } from "../shared/network-target";

test("probe targets accept pasted website URLs, paths, ports and IPv6 without sending paths to probes", () => {
  const cases: [string, { host: string; port?: number }][] = [
    ["yellowdogsleague.online/versus/", { host: "yellowdogsleague.online" }],
    [" https://yellowdogsleague.online/versus/\u00a0", { host: "yellowdogsleague.online", port: 443 }],
    ["HTTPS://YellowDogsLeague.online:443/versus/?a=1&b=2#top", { host: "yellowdogsleague.online", port: 443 }],
    ["yellowdogsleague.online/versus/?next=https://example.com/", { host: "yellowdogsleague.online" }],
    ["http://example.com/path", { host: "example.com", port: 80 }],
    ["example.com:80/path", { host: "example.com", port: 80 }],
    ["example.com:8443/path", { host: "example.com", port: 8443 }],
    ["//example.com:8080/path", { host: "example.com", port: 8080 }],
    ["example.com.", { host: "example.com" }],
    ["127.0.0.1", { host: "127.0.0.1" }],
    ["localhost", { host: "localhost" }],
    ["::1", { host: "::1" }],
    ["2001:db8::80", { host: "2001:db8::80" }],
    ["[::1]:8080/path", { host: "::1", port: 8080 }],
    ["https://[2001:db8::1]/", { host: "2001:db8::1", port: 443 }],
    ["https://例子.中国/", { host: "xn--fsqu00a.xn--fiqs8s", port: 443 }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(parseNetworkTarget(input), expected, input);
});

test("invalid or ambiguous probe targets fail before probing", () => {
  for (const input of ["", " ", "/versus/", "https:///example.com", "https://", "https://user:pass@example.com/",
    "example.com@other.com", "ftp://example.com/path", "file:///C:/test", "javascript:alert(1)",
    "127.0.0.1; calc.exe", "127.0.0.1&calc", "https://example.com\n/path", "example.com\\path",
    "-bad.com", "a..com", "example.com:", "example.com:0", "example.com:65536", "http://example.com:bad/",
    "[2001:db8:::1]", "a".repeat(64)+".com", "example.com/"+"a".repeat(2048)]) {
    assert.throws(() => parseNetworkTarget(input), { message: NETWORK_TARGET_ERROR }, input);
  }
});

const local:LocalNetworkInfo={adapters:[],dns:[],proxy:{enabled:false}};
test("IP data parsing keeps location separate from ISP and rejects HTML, invalid IPs and provider errors",()=>{
  const ipip=parsePublicRoute({source:"ipip",body:"当前 IP：203.0.113.2  来自于：中国 四川 成都  移动\n",viaProxy:true,proxyAddress:"127.0.0.1:7890"});
  assert.equal(ipip.ip,"203.0.113.2");assert.equal(ipip.location,"中国 · 四川 · 成都");assert.equal(ipip.organization,"移动");assert.equal(ipip.viaProxy,true);
  const v6=parsePublicRoute({source:"ipapi",body:JSON.stringify({ip:"2001:db8::1",country_name:"Test",region:"Region",city:"City",asn:"AS123",org:"Example"})});assert.equal(v6.family,"IPv6");assert.equal(v6.asn,"AS123");
  for(const body of ['<html>verification</html>','{"ip":"bad"}','{"error":true,"ip":"203.0.113.3"}'])assert.equal(parsePublicRoute({body,source:"ipapi"}).ip,undefined);
});
test("proxy classification uses observed route; equal exits do not disprove proxy or TUN",()=>{
  const direct={ip:"203.0.113.2",viaProxy:false};
  assert.equal(proxyAssessment(local,direct,{...direct,viaProxy:true}).proxyStatus,"confirmed");
  assert.equal(proxyAssessment({...local,proxy:{enabled:true}},direct,{error:"timeout"}).proxyStatus,"configured");
  assert.equal(proxyAssessment({...local,adapters:[{name:"TUN",addresses:[],dns:[],gateways:[],tunnelSuspected:true}]},direct,direct).proxyStatus,"tunnel");
  assert.equal(proxyAssessment(local,direct,direct).proxyStatus,"not-detected");
  assert.equal(proxyAssessment(local,direct,{...direct,ip:"198.51.100.1"}).proxyStatus,"unknown");
  assert.equal(proxyAssessment(local,{},{}).proxyStatus,"unknown");
});
test("known nodes use distinct fixed backend protocols and no unverified NJU endpoint",()=>{
  assert.equal(speedNodes[0].id,"nuaa");assert.ok(!speedNodes.some(n=>n.id==='nju'));
  assert.match(speedUrl(speedNodes[0],"download",2097152).href,/backend\/garbage.php\?.*ckSize=2/);
  assert.match(speedUrl(speedNodes[1],"download",2097152).href,/__down\?.*bytes=2097152/);
  assert.match(speedUrl(speedNodes[0],"upload",1024).href,/empty.php/);
});

async function fixture(){
  let uploaded=0,posts=0,activeDownloads=0,overlapping=false,closedSockets=0,connections=0;
  const cacheHeaders:unknown[]=[];
  const server=createServer((req,res)=>{
    cacheHeaders.push(req.headers['cache-control']);
    const url=new URL(req.url!,"http://localhost");
    if(url.pathname==='/stall')return;
    if(url.pathname.startsWith('/error')){res.writeHead(503);res.end();return;}
    if(url.pathname==='/html'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>verify</html>');return;}
    if(req.method==='POST'){posts++;if(activeDownloads)overlapping=true;req.on('data',data=>{uploaded+=data.length;req.pause();setTimeout(()=>req.resume(),3);});req.on('end',()=>res.end());return;}
    const bytes=url.pathname==='/partial'?1024:Number(url.searchParams.get('ckSize')||1)*1048576;
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes});
    activeDownloads++;
    let remaining=bytes;
    const timer=setInterval(()=>{const n=Math.min(65536,remaining);res.write(Buffer.alloc(n,0x61));remaining-=n;if(!remaining){clearInterval(timer);res.end();}},12);
    res.once('close',()=>{clearInterval(timer);activeDownloads--;});
  });
  server.on('connection',socket=>{connections++;socket.once('close',()=>closedSockets++);});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port+'/';
  const node:SpeedEndpoint={id:'local-test',name:'Local test',host:'127.0.0.1',base,region:'test',download:true,upload:true,protocol:'librespeed'};
  return {node,uploaded:()=>uploaded,stats:()=>({posts,overlapping,activeDownloads,connections,closedSockets,cacheHeaders}),close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})};
}
test("timed transfers run download then upload, preserve sampled peaks and clean every connection",async()=>{
  const f=await fixture();
  try{
    const job:NetworkJob={id:'test',kind:'speed',status:'running',phase:'准备',startedAt:Date.now(),progress:0,result:{target:f.node.host}};
    const begin=performance.now(),pending=runSpeed(job,f.node,new AbortController().signal,{durationMs:800,sampleMs:100});
    await new Promise(r=>setTimeout(r,350));
    assert.ok(job.result.speedSamples!.length>=2);assert.ok(job.result.liveMbps!>0);assert.ok(job.progress>0&&job.progress<100);
    await pending;
    assert.ok(performance.now()-begin>=1590);assert.ok(performance.now()-begin<2600);
    assert.ok(job.result.downloadedBytes!>0&&job.result.downloadedBytes!<16*1048576);assert.ok(job.result.uploadedBytes!>0);assert.ok(f.uploaded()>0);
    const samples=job.result.speedSamples!;
    assert.ok(samples.some(s=>s.direction==='download'&&s.mbps>0));assert.ok(samples.some(s=>s.direction==='upload'&&s.mbps>0));
    assert.ok(samples.every((s,i)=>!i||s.elapsedMs>=samples[i-1].elapsedMs));assert.ok(job.result.downloadMbps!>0);assert.ok(job.result.uploadMbps!>0);assert.equal(job.result.activeDirection,undefined);
    assert.equal(job.result.downloadDurationMs,800);assert.equal(job.result.uploadDurationMs,800);
    assert.equal(job.result.downloadPeakMbps,Math.max(...samples.filter(s=>s.direction==='download').map(s=>s.mbps)));
    assert.equal(job.result.uploadPeakMbps,Math.max(...samples.filter(s=>s.direction==='upload').map(s=>s.mbps)));
    assert.equal(job.result.downloadMbps,Number((job.result.downloadedBytes!*8/800/1000).toFixed(2)));
    assert.equal(job.result.uploadMbps,Number((job.result.uploadedBytes!*8/800/1000).toFixed(2)));
    const firstUpload=samples.findIndex(s=>s.direction==='upload');assert.ok(firstUpload>0);assert.ok(samples.slice(firstUpload).every(s=>s.direction==='upload'));
    assert.equal(samples[firstUpload].phaseElapsedMs,0);assert.ok(samples.at(-1)!.phaseElapsedMs!<=800);
    assert.deepEqual(JSON.parse(JSON.stringify(job)).result.speedSamples,samples);
    // The peer may still drain bytes already queued in the OS when the client
    // closes; no new writes occur after the deadline.
    for(let i=0;i<40&&f.stats().closedSockets!==f.stats().connections;i++)await new Promise(r=>setTimeout(r,25));
    assert.equal(f.stats().overlapping,false);assert.equal(f.stats().activeDownloads,0);assert.equal(f.stats().closedSockets,f.stats().connections);
    assert.ok(f.stats().cacheHeaders.every(value=>value==='no-store'));
  }finally{await f.close();}
});
test("stopping during download preserves measured data and never starts upload",async()=>{
  const f=await fixture(),controller=new AbortController();
  const job:NetworkJob={id:'cancel-test',kind:'speed',status:'running',phase:'准备',startedAt:Date.now(),progress:0,result:{target:f.node.host}};
  const timer=setTimeout(()=>controller.abort(),275);
  try{
    await assert.rejects(runSpeed(job,f.node,controller.signal,{durationMs:800,sampleMs:100}),/abort/i);
    assert.ok(job.result.downloadedBytes!>0);assert.ok(job.result.downloadPeakMbps!>0);assert.equal(job.result.downloadMbps,undefined);assert.equal(job.result.uploadMbps,undefined);assert.equal(f.stats().posts,0);
    assert.equal(job.result.activeDirection,undefined);assert.equal(job.result.liveMbps,undefined);
    const snapshot=JSON.stringify(job);await new Promise(r=>setTimeout(r,150));assert.equal(JSON.stringify(job),snapshot);
    assert.equal(f.stats().closedSockets,f.stats().connections);
  }finally{clearTimeout(timer);await f.close();}
});
test("node errors do not become successful timed stages and failure stops the other worker",async()=>{
  const f=await fixture();
  const job:NetworkJob={id:'error-test',kind:'speed',status:'running',phase:'准备',startedAt:Date.now(),progress:0,result:{target:f.node.host}};
  try{
    // Resolving all relative requests through this base yields the fixture's error path.
    const node={...f.node,base:f.node.base+'error/',protocol:'librespeed' as const};
    await assert.rejects(runSpeed(job,node,new AbortController().signal,{durationMs:800,sampleMs:100}),/503/);
    assert.equal(job.result.downloadMbps,undefined);assert.equal(f.stats().posts,0);
    await new Promise(r=>setTimeout(r,50));assert.equal(f.stats().closedSockets,f.stats().connections);
  }finally{await f.close();}
});
test("stopping during upload retains completed download and partial upload peak",async()=>{
  const f=await fixture(),controller=new AbortController();
  const job:NetworkJob={id:'upload-cancel',kind:'speed',status:'running',phase:'准备',startedAt:Date.now(),progress:0,result:{target:f.node.host}};
  const timer=setTimeout(()=>controller.abort(),1100);
  try{
    await assert.rejects(runSpeed(job,f.node,controller.signal,{durationMs:800,sampleMs:100}),/abort/i);
    assert.ok(job.result.downloadMbps!>0);assert.equal(job.result.downloadDurationMs,800);assert.ok(job.result.uploadPeakMbps!>0);
    assert.equal(job.result.uploadMbps,undefined);assert.ok(job.result.uploadDurationMs!<800);
    assert.equal(job.result.activeDirection,undefined);
  }finally{clearTimeout(timer);await f.close();}
});
test("transfer rejects server errors, verification pages and incomplete downloads",async()=>{
  const f=await fixture();try{
    for(const [path,reason] of [['error',/503/],['html',/验证页面/],['partial',/不完整/]] as const)
      await assert.rejects(transfer(new URL(path,f.node.base),'download',1048576,new AbortController().signal,()=>{}),reason);
  }finally{await f.close();}
});
test("stalled transfers time out and cancellation interrupts transfers with partial samples",async()=>{
  const f=await fixture();try{
    await assert.rejects(transfer(new URL('stall',f.node.base),'download',1048576,new AbortController().signal,()=>{},{idleMs:70,timeoutMs:500}),/无数据/);
    const controller=new AbortController();let bytes=0;
    const pending=transfer(speedUrl(f.node,'download',2097152),'download',2097152,controller.signal,n=>{bytes+=n;if(bytes>=131072)controller.abort();});
    await assert.rejects(pending,/abort/i);assert.ok(bytes>0&&bytes<2097152);
  }finally{await f.close();}
});
