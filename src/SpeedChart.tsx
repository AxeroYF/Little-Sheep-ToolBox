import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { SPEED_PHASE_MS, type SpeedSample } from "../shared/network";
const value=(n:number|undefined)=>n===undefined?'—':n.toLocaleString(undefined,{maximumFractionDigits:2});
// Shape-preserving cubic interpolation: pass through the real samples without
// introducing peaks or negative speeds between them. Statistics stay untouched.
function smoothPath(input:{x:number;y:number}[]) {
  const points=input.filter((p,i)=>!i||p.x>input[i-1].x);
  if(!points.length)return '';
  const f=(n:number)=>n.toFixed(2);
  let path=`M${f(points[0].x)},${f(points[0].y)}`;
  if(points.length===1)return path;
  const widths=points.slice(1).map((p,i)=>p.x-points[i].x);
  const slopes=points.slice(1).map((p,i)=>(p.y-points[i].y)/widths[i]);
  const tangents=points.map((_,i)=>{
    if(i===0)return slopes[0];if(i===points.length-1)return slopes.at(-1)!;
    const before=slopes[i-1],after=slopes[i];
    if(before*after<=0)return 0;
    const w1=2*widths[i]+widths[i-1],w2=widths[i]+2*widths[i-1];
    return (w1+w2)/(w1/before+w2/after);
  });
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],third=widths[i-1]/3;
    path+=` C${f(a.x+third)},${f(a.y+tangents[i-1]*third)} ${f(b.x-third)},${f(b.y-tangents[i]*third)} ${f(b.x)},${f(b.y)}`;
  }
  return path;
}
type Props={samples:SpeedSample[];direction:'download'|'upload';running:boolean;status:string;average?:number;peak?:number;durationMs?:number;elapsedMs?:number};
export function SpeedChart({samples,direction,running,status,average,peak:recordedPeak,durationMs=SPEED_PHASE_MS,elapsedMs}:Props) {
  const id=useId().replaceAll(':',''),[hover,setHover]=useState<number|null>(null),[width,setWidth]=useState(480);
  const svg=useRef<SVGSVGElement>(null);
  useEffect(()=>{const el=svg.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setWidth(Math.max(260,entry.contentRect.width)));observer.observe(el);return()=>observer.disconnect();},[]);
  const filtered=samples.filter(s=>s.direction===direction&&Number.isFinite(s.mbps)&&s.mbps>=0&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>=0);
  const offset=filtered[0]?.elapsedMs??0;
  const points=filtered.map(s=>({...s,t:s.phaseElapsedMs??s.elapsedMs-offset}));
  const measured=points.filter(s=>s.t>0),latest=measured.at(-1);
  const peak=recordedPeak??(measured.length?Math.max(...measured.map(s=>s.mbps)):undefined);
  const height=228,left=42,right=15,top=16,bottom=28;
  const magnitude=10**Math.floor(Math.log10(Math.max(1,peak??0))),max=Math.max(1,Math.ceil((peak??0)/magnitude)*magnitude);
  const duration=Math.max(1000,durationMs,points.at(-1)?.t??0);
  const x=(t:number)=>left+t/duration*(width-left-right),y=(speed:number)=>top+(1-speed/max)*(height-top-bottom);
  const line=smoothPath(points.map(s=>({x:x(s.t),y:y(s.mbps)})));
  const active=hover===null?null:measured[hover];
  const time=elapsedMs??latest?.t??0;
  const Icon=direction==='download'?ArrowDown:ArrowUp;
  return <section className={`speed-chart ${direction}`} aria-label={direction==='download'?'下载速度':'上传速度'}>
    <div className="speed-card-heading"><h3><Icon size={17}/>{direction==='download'?'下载':'上传'}</h3><span className={running?'status-running':'muted'}>{status}</span></div>
    <div className="speed-card-values"><div><span className="speed-value-label">{running?'实时':'平均'}</span><strong className="speed-current">{value(running?latest?.mbps:average)}</strong><small>Mbps</small></div><div className="speed-peak"><span>最高</span><strong>{value(peak)}</strong><small>Mbps</small></div></div>
    <div className="speed-chart-readout">{active?`${(active.t/1000).toFixed(1)} s · ${value(active.mbps)} Mbps`:'Mbps'}</div>
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${direction==='download'?'下载':'上传'}平滑速度曲线，悬停查看实际采样值`} onPointerLeave={()=>setHover(null)} onPointerMove={event=>{
      const rect=event.currentTarget.getBoundingClientRect(),at=(event.clientX-rect.left)/rect.width*width;
      if(measured.length)setHover(measured.reduce((best,s,i)=>Math.abs(x(s.t)-at)<Math.abs(x(measured[best].t)-at)?i:best,0));
    }}>
      <title>{direction==='download'?'下载':'上传'}速度，每秒采样，悬停查看实时值</title>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".22"/><stop offset="100%" stopColor="currentColor" stopOpacity=".015"/></linearGradient></defs>
      {[0,.5,1].map(r=><g key={r}><line className="speed-grid" x1={left} x2={width-right} y1={y(max*r)} y2={y(max*r)}/><text className="speed-axis" x={left-8} y={y(max*r)+4} textAnchor="end">{value(max*r)}</text></g>)}
      {[0,.2,.4,.6,.8,1].map(r=><g key={r}><line className="speed-grid vertical" x1={x(duration*r)} x2={x(duration*r)} y1={top} y2={height-bottom}/><text className="speed-axis" x={x(duration*r)} y={height-7} textAnchor="middle">{value(duration*r/1000)} s</text></g>)}
      {!!points.length&&<g className="speed-series"><path d={`${line} L${x(points.at(-1)!.t)},${y(0)} L${x(points[0].t)},${y(0)} Z`} fill={`url(#${id})`}/><path d={line} className="speed-line"/></g>}
      {measured.map((s,i)=><circle className="speed-sample" key={s.t} cx={x(s.t)} cy={y(s.mbps)} r={i===measured.length-1&&running?4:2.7}/>)}
      {active&&<g className="speed-crosshair"><line x1={x(active.t)} x2={x(active.t)} y1={top} y2={height-bottom}/><circle cx={x(active.t)} cy={y(active.mbps)} r="4"/></g>}
      {!measured.length&&<text className="speed-axis" x={(width+left)/2} y={height/2} textAnchor="middle">{running?'正在采样…':status}</text>}
    </svg>
    <div className="speed-chart-summary"><span>{value(Math.min(time,duration)/1000)} / {value(duration/1000)} s</span><span>{direction==='upload'?'本机发送估算':'每秒实时采样'}</span></div>
  </section>;
}
