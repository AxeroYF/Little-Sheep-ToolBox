import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { getServers } from "node:dns";
import { isIP } from "node:net";
import type { LocalNetworkInfo, NetworkIdentity, PublicRoute } from "../shared/network";

export function nativeInfo<T>(path: string,args: string[],signal: AbortSignal,timeout=16000): Promise<T> {
  return new Promise((ok,fail)=>{
    signal.throwIfAborted();
    if(!existsSync(path)){fail(new Error("网络信息组件缺失，请重新构建桌面版"));return;}
    const child=spawn(path,args,{windowsHide:true,shell:false,stdio:["ignore","pipe","pipe"],env:{...process.env,WORKBOX_PROBE_PARENT_PID:String(process.pid)}});
    let text="",done=false;
    const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener("abort",abort);if(!child.killed)child.kill();if(error)fail(error);else try{ok(JSON.parse(text.replace(/^\uFEFF/,"")));}catch{fail(new Error("网络信息返回格式错误"));}};
    const abort=()=>finish(new Error("已取消网络检测"));
    const timer=setTimeout(()=>finish(new Error("网络信息查询超时")),timeout);
    signal.addEventListener("abort",abort,{once:true});
    child.stdout.on("data",chunk=>{text+=chunk;if(text.length>65536)finish(new Error("网络信息响应过大"));});
    child.stderr.resume();child.once("error",()=>finish(new Error("网络信息组件无法启动")));child.once("exit",code=>finish(code===0?undefined:new Error("网络信息检测失败")));
  });
}
export async function localNetworkInfo(path: string,signal: AbortSignal): Promise<LocalNetworkInfo> {
  try{return await nativeInfo(path,["info"],signal,4000);}catch(e){
    signal.throwIfAborted();
    return {adapters:Object.entries(networkInterfaces()).flatMap(([name,items])=>{
      const addresses=(items??[]).filter(i=>!i.internal).map(i=>i.address);return addresses.length?[{name,addresses,gateways:[],dns:[]}]:[];
    }),dns:getServers(),proxy:{enabled:null,error:"系统代理未读取"},error:e instanceof Error?e.message:"本地信息不完整"};
  }
}
interface RawRoute { body?: string; source?: string; viaProxy?: boolean | null; proxyAddress?: string; error?: string }
export function parsePublicRoute(raw: RawRoute): PublicRoute {
  const result: PublicRoute={source:raw.source==="ipip"?"IPIP":raw.source==="ipapi"?"ipapi.co":raw.source,viaProxy:raw.viaProxy??null,proxyAddress:raw.proxyAddress};
  if(!raw.body)return {...result,error:raw.error||"未获取公网信息"};
  let ip="";
  if(raw.source==="ipip"){
    const match=raw.body.match(/当前\s*IP[：:]\s*(\S+)\s+来自(?:于)?[：:]\s*([^\r\n<]+)/i);
    if(match){ip=match[1];const fields=match[2].trim().split(/\s{2,}/);result.location=fields[0].split(/\s+/).join(" · ");result.organization=fields.slice(1).join(" · ")||undefined;}
  } else if(raw.source==="ipapi")try{
    const data=JSON.parse(raw.body);if(data.error)throw new Error();ip=data.ip;
    const text=(value:unknown)=>typeof value==="string"?value.slice(0,180):undefined;
    result.location=[text(data.country_name),text(data.region),text(data.city)].filter(Boolean).join(" · ");result.organization=text(data.org);result.asn=text(data.asn);result.timezone=text(data.timezone);
  }catch{}
  if(typeof ip!=="string"||!isIP(ip))return {...result,error:"查询服务未返回有效 IP"};
  return {...result,ip,family:isIP(ip)===6?"IPv6":"IPv4"};
}
export function proxyAssessment(local: LocalNetworkInfo,direct: PublicRoute,system: PublicRoute): Pick<NetworkIdentity,"proxyStatus"|"proxyLabel"> {
  if(system.ip&&system.viaProxy===true)return {proxyStatus:"confirmed",proxyLabel:"系统代理已用于查询"};
  if(local.proxy.enabled||local.proxy.pacConfigured||system.viaProxy===true)return {proxyStatus:"configured",proxyLabel:"已配置代理 · 本次使用情况未确认"};
  if(local.adapters.some(a=>a.tunnelSuspected))return {proxyStatus:"tunnel",proxyLabel:"检测到疑似 VPN / TUN 网卡"};
  if(direct.ip&&system.ip&&direct.ip!==system.ip)return {proxyStatus:"unknown",proxyLabel:"两次查询出口不同 · 原因未确认"};
  if(local.proxy.enabled===false&&system.ip&&system.viaProxy===false)return {proxyStatus:"not-detected",proxyLabel:"本次查询未使用系统 HTTP 代理"};
  return {proxyStatus:"unknown",proxyLabel:"代理状态未确认"};
}
export async function inspectIdentity(path: string,signal: AbortSignal,local: LocalNetworkInfo):Promise<NetworkIdentity> {
  let direct:PublicRoute={},system:PublicRoute={};
  for(const provider of ["ipip","ipapi"]){
    signal.throwIfAborted();
    try{
      const raw=await nativeInfo<{direct:RawRoute;system:RawRoute}>(path,["identity",provider],signal);
      const d=parsePublicRoute(raw.direct),s=parsePublicRoute(raw.system);
      // Keep both observations from the same provider so split routing stays explicit.
      if(d.ip||s.ip||!direct.ip&&!system.ip){direct=d;system=s;}
      if(d.ip&&s.ip)break;
    }catch(e){signal.throwIfAborted();const error=e instanceof Error?e.message:"公网查询失败";if(!direct.ip)direct={error};if(!system.ip)system={error};}
  }
  return {checkedAt:Date.now(),direct,system,...proxyAssessment(local,direct,system)};
}
