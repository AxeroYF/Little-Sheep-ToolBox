import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { request as httpRequest, Agent as HttpAgent, type RequestOptions } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { SPEED_PHASE_MS, SPEED_SAMPLE_MS, type NetworkJob, type SpeedNode } from "../shared/network";

export interface SpeedEndpoint extends SpeedNode {
  protocol: "librespeed" | "cloudflare";
  base: string;
}

// Options are for controlled local tests only. The public API always uses 15 s.
type SpeedRunOptions = { durationMs?: number; sampleMs?: number; chunkBytes?: number; transferOptions?: TransferOptions };
export async function runSpeed(job: NetworkJob,node: SpeedEndpoint,signal: AbortSignal,options: SpeedRunOptions={}) {
  const durationMs=options.durationMs??SPEED_PHASE_MS,sampleMs=options.sampleMs??SPEED_SAMPLE_MS;
  Object.assign(job.result,{endpoint:node.base,nodeId:node.id,nodeName:node.name,mode:'timed',phaseDurationMs:durationMs,speedSamples:[],transferRoute:'直连请求（不读取系统 HTTP 代理，VPN / TUN 仍可能影响线路）'});
  const origin=performance.now();
  // Await every worker's socket teardown before starting the next direction.
  for(const direction of ['download','upload'] as const){
    signal.throwIfAborted();
    const phase=new AbortController(),timeLimit=new Error('测时结束'),abort=()=>phase.abort(signal.reason);
    const agent=node.base.startsWith('https:')?new HttpsAgent({keepAlive:true,maxSockets:2}):new HttpAgent({keepAlive:true,maxSockets:2});
    signal.addEventListener('abort',abort,{once:true});
    const start=performance.now(),end=start+durationMs;
    let bytes=0,lastBytes=0,lastTime=start,firstError:unknown;
    job.phase=direction==='download'?'下载测速':'上传测速';
    job.result.activeDirection=direction;job.result.phaseElapsedMs=0;job.result.liveMbps=undefined;
    job.progress=direction==='download'?0:50;
    const bytesKey=direction==='download'?'downloadedBytes':'uploadedBytes';
    const peakKey=direction==='download'?'downloadPeakMbps':'uploadPeakMbps';
    const durationKey=direction==='download'?'downloadDurationMs':'uploadDurationMs';
    job.result[bytesKey]=0;
    job.result.speedSamples!.push({elapsedMs:Math.round(start-origin),phaseElapsedMs:0,direction,mbps:0,bytes:0});
    const sample=()=>{
      const now=Math.min(performance.now(),end),elapsed=now-start,delta=now-lastTime;
      job.result.phaseElapsedMs=Math.round(elapsed);job.result[durationKey]=Math.round(elapsed);
      job.progress=Math.min(99,Math.round((direction==='download'?0:50)+elapsed/durationMs*50));
      // Avoid a tiny extra interval inventing a spurious final peak.
      if(delta<Math.min(50,sampleMs/2))return;
      const speed=Number(((bytes-lastBytes)*8/delta/1000).toFixed(2));
      job.result.liveMbps=speed;job.result[peakKey]=Math.max(job.result[peakKey]??0,speed);
      job.result.speedSamples!.push({elapsedMs:Math.round(now-origin),phaseElapsedMs:Math.round(elapsed),direction,mbps:speed,bytes});
      lastBytes=bytes;lastTime=now;
    };
    const deadline=setTimeout(()=>phase.abort(timeLimit),durationMs);
    const timer=setInterval(sample,sampleMs);
    const chunk=options.chunkBytes??(direction==='download'?16:4)*1048576;
    const worker=async()=>{
      try{
        while(!phase.signal.aborted){
          if(performance.now()>=end){phase.abort(timeLimit);break;}
          await transfer(speedUrl(node,direction,chunk),direction,chunk,phase.signal,n=>{
            if(phase.signal.aborted||performance.now()>=end)return;
            bytes+=n;job.result[bytesKey]=bytes;
          },{...options.transferOptions,requestOptions:{...options.transferOptions?.requestOptions,agent}});
        }
      }catch(error){
        if(!phase.signal.aborted){firstError??=error;phase.abort(error);}
      }
    };
    try{
      await Promise.all([worker(),worker()]);
      sample();
      signal.throwIfAborted();
      if(firstError)throw firstError;
      if(phase.signal.reason!==timeLimit)throw phase.signal.reason??new Error('测速意外中断');
      if(!bytes)throw new Error('节点没有有效测速数据，请切换节点');
      const average=Number((bytes*8/durationMs/1000).toFixed(2));
      if(direction==='download')job.result.downloadMbps=average;else job.result.uploadMbps=average;
      job.result[durationKey]=durationMs;
    }finally{
      clearInterval(timer);clearTimeout(deadline);phase.abort();agent.destroy();signal.removeEventListener('abort',abort);
      job.result.activeDirection=undefined;job.result.liveMbps=undefined;
    }
  }
}
// Only these fixed public test backends can receive generated test data.
export const speedNodes: SpeedEndpoint[] = [
  { id: "nuaa", name: "南京航空航天大学", region: "江苏南京 · 教育网", host: "speed.nuaa.edu.cn", download: true, upload: true, protocol: "librespeed", base: "https://speed.nuaa.edu.cn/backend/" },
  { id: "cloudflare", name: "Cloudflare", region: "全球边缘网络", host: "speed.cloudflare.com", download: true, upload: true, protocol: "cloudflare", base: "https://speed.cloudflare.com/" },
];
export function publicSpeedNodes(): SpeedNode[] { return speedNodes.map(({protocol,base,...node})=>node); }
export function speedUrl(node: SpeedEndpoint, direction: "download" | "upload", bytes: number) {
  const route = node.protocol === "cloudflare" ? (direction === "download" ? "__down" : "__up") : (direction === "download" ? "garbage.php" : "empty.php");
  const url = new URL(route,node.base);
  url.searchParams.set("r",randomUUID());
  if(direction === "download")url.searchParams.set(node.protocol === "cloudflare" ? "bytes" : "ckSize",String(node.protocol === "cloudflare" ? bytes : Math.ceil(bytes/1048576)));
  return url;
}
type TransferOptions = { timeoutMs?: number; idleMs?: number; connectMs?: number; requestOptions?: RequestOptions };
// Upload progress counts body buffers handed to the socket, not memory queued by write().
// Both timed upload statistics and its chart are a client-side sending estimate.
export function transfer(url: URL, direction: "download" | "upload", bytes: number, signal: AbortSignal, onBytes: (n: number)=>void, options: TransferOptions = {}): Promise<number> {
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    let received=0,sent=0,settled=false;
    const request=url.protocol === "https:" ? httpsRequest : httpRequest;
    const req=request(url,{...options.requestOptions,method:direction === "download" ? "GET" : "POST",signal,headers:{
      "User-Agent":"XiaoyangNetworkTest/0.4", "Cache-Control":"no-store", "Accept-Encoding":"identity",
      ...(direction === "upload" ? {"Content-Type":"application/octet-stream","Content-Length":String(bytes)} : {}),
    }});
    const total=setTimeout(()=>finish(new Error("本阶段请求超时，请切换测速节点")),options.timeoutMs??45000);
    const connecting=setTimeout(()=>finish(new Error("节点连接超时，请切换测速节点")),options.connectMs??6000);
    const finish=(error?: Error)=>{
      if(settled)return;settled=true;clearTimeout(total);clearTimeout(connecting);
      const done=()=>error?reject(error):resolve(direction === "download" ? received : sent);
      // Wait for the request to close: the next direction cannot inherit an
      // active download, and cancellation releases its socket/body buffers.
      if(req.closed)done();else req.once('close',done);
      req.destroy();
    };
    req.on("socket",socket=>{
      const event=url.protocol === "https:" ? "secureConnect" : "connect";
      if(!socket.connecting && !('secureConnecting' in socket && socket.secureConnecting))clearTimeout(connecting);
      else socket.once(event,()=>clearTimeout(connecting));
    });
    req.setTimeout(options.idleMs??10000,()=>finish(new Error("节点长时间无数据，请切换测速节点")));
    req.once("error",e=>finish(e));
    req.once("response",res=>{
      if(res.statusCode !== 200){res.destroy();finish(new Error(`节点返回 HTTP ${res.statusCode}，请切换节点`));return;}
      if(direction === "download" && ((res.headers["content-encoding"] && res.headers["content-encoding"]!=="identity") || /text\/html|application\/json/i.test(String(res.headers["content-type"])))) {
        res.destroy();finish(new Error("节点返回了验证页面或无效测速数据，请切换节点"));return;
      }
      res.on("data",(chunk: Buffer)=>{
        received+=chunk.length;
        if(direction === "download") {
          if(received>bytes){res.destroy();finish(new Error("节点返回超出预期的数据"));return;}
          onBytes(chunk.length);
        } else if(received>65536){res.destroy();finish(new Error("节点响应过大"));}
      });
      res.once("error",e=>finish(e));
      res.once("end",()=>finish(direction === "download" && received!==bytes ? new Error("下载数据不完整") : direction === "upload" && sent!==bytes ? new Error("上传未完成") : undefined));
      res.once("close",()=>{if(!res.complete)finish(new Error("测速连接中断，请切换节点"));});
    });
    if(direction === "download") req.end();
    else {
      const block=randomBytes(Math.min(65536,bytes));
      const write=()=>{
        if(settled||signal.aborted)return;
        const size=Math.min(block.length,bytes-sent);
        if(!size){req.end();return;}
        req.write(block.subarray(0,size),error=>{
          if(error){finish(error);return;}if(settled)return;
          sent+=size;onBytes(size);write();
        });
      };
      write();
    }
  });
}
