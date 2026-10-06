import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MousePointer2, PencilRuler, Undo2, Redo2, RotateCw, Copy, Trash2, Plus, Save, FolderOpen, Download, Upload, Magnet, Grid2X2, Scan, ZoomIn, ZoomOut, Hand, Armchair, Library, Table2, X, Check } from "lucide-react";
import { api } from "./api";
import { nativeMessage } from "./App";
import { bounds, distance, endWallStroke, footprint, furnitureCatalog, furnitureInside, joinWallStroke, measuredPoint, newPlan, normalizeAngle, overlap, polygonError, rectangle, removeWallSegment, roomCenter, rotatePoint, rotateRoom, roomPlanSchema, signedArea, snapAngle, snapDrawingPoint, snapFurniture, type Furniture, type FurnitureKind, type FurnitureModule, type Guide, type PlanSummary, type Point, type RoomPlan, type StoredPlan } from "../shared/room";
import "./room.css";

const message = (e: unknown) => e instanceof Error ? e.message : "操作失败";
const same = (a: unknown,b: unknown) => JSON.stringify(a)===JSON.stringify(b);
const kindIcon = { desk:Table2, shelf:Library, chair:Armchair };
type PaletteItem = Omit<FurnitureModule,"id"> & {id?: string};
type Gesture = { type:"move"; before:RoomPlan; id:string; offset:Point } | {type:"vertex"; before:RoomPlan; index:number; path:number|null} | {type:"palette"; before:RoomPlan; item:Furniture} | {type:"pan"; start:Point; view:View} | {type:"rotate"; before:RoomPlan; id:string|null; center:Point; startAngle:number; initial:number; withFurniture:boolean};
type View = {x:number;y:number;w:number};

function Numeric({label,value,min,max,onChange,step=10}:{label:string;value:number;min:number;max:number;step?:number;onChange:(value:number)=>void}) {
  const formatted=String(Number(value.toFixed(step<1?1:0)));
  const [draft,setDraft]=useState(formatted);
  const cancelled=useRef(false);
  useEffect(()=>setDraft(formatted),[formatted]);
  return <label className="room-field">{label}<input type="number" aria-label={label} min={min} max={max} step={step} value={draft}
    onChange={e=>{cancelled.current=false;setDraft(e.target.value);nativeMessage({action:'room-dirty',dirty:true});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelled.current=true;setDraft(formatted);e.currentTarget.blur();}}}
    onBlur={()=>{if(cancelled.current){cancelled.current=false;setDraft(formatted);return;}const n=Number(draft);if(draft.trim() && Number.isFinite(n) && n>=min && n<=max){if(draft!==formatted)onChange(step<1?Math.round(n*10)/10:Math.round(n));setDraft(formatted);}else setDraft(formatted);}}/></label>;
}
function RotationHandle({center,top,angle,scale,id,snapped,onStep}:{center:Point;top:number;angle:number;scale:number;id:string;snapped:boolean;onStep:(delta:number)=>void}) {
  const anchor=rotatePoint({x:center.x,y:center.y+top},center,angle),handle=rotatePoint({x:center.x,y:center.y+top-42*scale},center,angle);
  return <g className={'room-rotation '+(snapped?'snapped':'')} data-rotate={id}>
    <line x1={anchor.x} y1={anchor.y} x2={handle.x} y2={handle.y}/>
    <g transform={`translate(${handle.x} ${handle.y})`} role="button" tabIndex={0} aria-label={id==='room'?'拖动旋转房间':'拖动旋转家具'} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();onStep((e.key==='ArrowLeft'?-1:1)*(e.shiftKey?15:1));}}}>
      <title>拖动旋转 · Alt 暂停吸附 · 方向键微调</title><circle r={11*scale}/>
      <path d={`M${5*scale},${-2*scale} a${5*scale},${5*scale} 0 1 0 ${-1*scale},${6*scale} M${5*scale},${-6*scale} v${4*scale} h${-4*scale}`}/>
      <text y={-18*scale} textAnchor="middle" fontSize={11*scale}>{angle}°{snapped?' · 吸附':''}</text>
    </g>
  </g>;
}
function Dimension({a,b,offset,scale}:{a:Point;b:Point;offset:number;scale:number}) {
  const len=distance(a,b);if(len<1)return null;
  const nx=(b.y-a.y)/len,ny=-(b.x-a.x)/len;
  const x1=a.x+nx*offset,y1=a.y+ny*offset,x2=b.x+nx*offset,y2=b.y+ny*offset;
  let angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;if(angle>90||angle< -90)angle+=180;
  const text=Math.round(len).toLocaleString()+" mm",tick=5*scale;
  return <g className="room-dimension" pointerEvents="none">
    <path d={`M${a.x},${a.y} L${x1+nx*tick},${y1+ny*tick} M${b.x},${b.y} L${x2+nx*tick},${y2+ny*tick} M${x1},${y1} L${x2},${y2}`} />
    {[{x:x1,y:y1},{x:x2,y:y2}].map((p,i)=><path key={i} d={`M${p.x-tick},${p.y+tick} l${tick*2},${-tick*2}`}/>)}
    <g transform={`translate(${(x1+x2)/2} ${(y1+y2)/2}) rotate(${angle})`}><rect x={-text.length*3.4*scale} y={-9*scale} width={text.length*6.8*scale} height={18*scale} rx={4*scale}/><text fontSize={11*scale} textAnchor="middle" dominantBaseline="central">{text}</text></g>
  </g>;
}
function FurnitureShape({item,selected=false,warning=false,ghost=false,scale}:{item:Furniture;selected?:boolean;warning?:boolean;ghost?:boolean;scale:number}) {
  const {width:w,depth:d}=item, label=Math.max(10,Math.min(13,w/scale/12))*scale;
  return <g data-furniture={item.id} className={`room-furniture ${item.kind} ${selected?'selected':''} ${warning?'warning':''} ${ghost?'ghost':''}`} transform={`translate(${item.x} ${item.y})`}>
    <g transform={`rotate(${item.rotation})`}>
      <rect className="footprint" x={-w/2} y={-d/2} width={w} height={d} rx={Math.min(55,w/10,d/10)}/>
      {item.kind==='desk' && <><path d={`M${-w/2+50},${-d/2+80} h${w-100}`}/><rect className="furniture-detail" x={-w/2+50} y={d/2-120} width={w*.22} height={75} rx={16}/></>}
      {item.kind==='shelf' && <>{[.25,.5,.75].map(t=><path key={t} d={`M${-w/2+w*t},${-d/2+30} v${d-60}`}/>)}<path d={`M${-w/2+30},${d/2-65} h${w-60}`}/></>}
      {item.kind==='chair' && <><rect className="furniture-detail" x={-w*.36} y={-d*.28} width={w*.72} height={d*.62} rx={Math.min(w,d)*.16}/><path d={`M${-w*.37},${-d*.36} Q0,${-d*.52} ${w*.37},${-d*.36}`}/></>}
    </g>
    <text y={-label*.25} textAnchor="middle" fontSize={label}>{item.name.length>12?item.name.slice(0,11)+'…':item.name}</text>
    <text className="furniture-size" y={label*1.2} textAnchor="middle" fontSize={label*.8}>{w} × {d}</text>
  </g>;
}
export default function RoomPanel() {
  const [plan,setPlan]=useState<RoomPlan|null>(null), planRef=useRef<RoomPlan|null>(null);
  const [plans,setPlans]=useState<PlanSummary[]>([]),[modules,setModules]=useState<FurnitureModule[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[saveState,setSaveState]=useState('已保存');
  const [selected,setSelected]=useState<string|null>(null),[wall,setWall]=useState<number|null>(null);
  const [pathIndex,setPathIndex]=useState<number|null>(null);
  const [tool,setTool]=useState<'select'|'draw'|'pan'>('select'),[cursor,setCursorState]=useState<Point|null>(null),[bypassSnap,setBypassSnap]=useState(false);
  const cursorRef=useRef<Point|null>(null);
  function setCursor(p:Point|null){cursorRef.current=p;setCursorState(p);}
  const draft=plan?.room.draft??[];
  const [grid,setGrid]=useState(true),[snap,setSnap]=useState(true),[ortho,setOrtho]=useState(true),[dimensions,setDimensions]=useState(true);
  const [angleSnap,setAngleSnap]=useState(true),[withFurniture,setWithFurniture]=useState(true),[rotationHint,setRotationHint]=useState<{angle:number;snapped:boolean}|null>(null);
  const [rectWidth,setRectWidth]=useState('4000'),[rectDepth,setRectDepth]=useState('3000');
  const [lengthEntry,setLengthEntry]=useState<{value:string;toward:Point}|null>(null),lengthInput=useRef<HTMLInputElement>(null);
  const [library,setLibrary]=useState<'base'|'saved'>('base'),[moduleName,setModuleName]=useState<string|null>(null),[moduleBusy,setModuleBusy]=useState(false);
  const [ghost,setGhost]=useState<Furniture|null>(null),[guides,setGuides]=useState<Guide[]>([]),[interacting,setInteracting]=useState(false);
  const [view,setView]=useState<View>({x:-700,y:-900,w:5400}),[size,setSize]=useState({w:600,h:560});
  const canvas=useRef<SVGSVGElement>(null),file=useRef<HTMLInputElement>(null),gesture=useRef<Gesture|null>(null),space=useRef(false);
  const history=useRef<RoomPlan[]>([]),future=useRef<RoomPlan[]>([]),[,refreshHistory]=useState(0);
  const saved=useRef({id:'',revision:0,json:''}),saving=useRef<Promise<void>|null>(null),mounted=useRef(true);
  const aspect=size.w/size.h,scale=view.w/size.w;
  const scaleRef=useRef(scale);scaleRef.current=scale;
  const settings=useRef({grid,snap,angleSnap});settings.current={grid,snap,angleSnap};
  const viewRef=useRef(view);viewRef.current=view;
  function preview(p:RoomPlan){planRef.current=p;setPlan(p);nativeMessage({action:'room-dirty',dirty:JSON.stringify(p)!==saved.current.json});}
  function commit(p:RoomPlan,before=planRef.current) {
    const check=roomPlanSchema.safeParse(p);if(!check.success){setError(check.error.issues[0].message);return;}
    if(before && !same(before,p)){history.current=[...history.current.slice(-79),before];future.current=[];refreshHistory(v=>v+1);}
    preview(check.data);setError('');
  }
  function setDraft(points:Point[]){const p=planRef.current;if(p)commit({...p,room:{...p.room,draft:points}});}
  function endDrawing(nextTool:'select'|'draw'|'pan'='draw'){
    const p=planRef.current;if(p){const ended=endWallStroke(p);const check=roomPlanSchema.safeParse(ended);if(!check.success){setError(check.error.issues[0].message);return;}if(ended!==p){
      // Ending a command changes its editing state, not its geometry. Undo
      // should remove drawn segments without reactivating a finished command.
      history.current=history.current.map(endWallStroke);future.current=[];preview(check.data);refreshHistory(v=>v+1);
    }}
    setLengthEntry(null);setCursor(null);setTool(nextTool);setSelected(null);setWall(null);setPathIndex(null);setError('');canvas.current?.focus();
  }
  useEffect(()=>{if(lengthEntry)lengthInput.current?.select();},[!!lengthEntry]);
  const fit=useCallback((p:RoomPlan)=>{
    const points=[...p.room.vertices,...p.room.paths.flat(),...p.room.draft,...p.furniture.flatMap(footprint)],b=bounds(points),ratio=(canvas.current?.clientWidth||600)/(canvas.current?.clientHeight||560);
    const w=points.length?Math.max(b.maxX-b.minX+1200,(b.maxY-b.minY+1200)*ratio):8000;
    setView({x:(b.minX+b.maxX-w)/2,y:(b.minY+b.maxY-w/ratio)/2,w});
  },[]);
  function adopt(input:RoomPlan,revision=0,clean=false) {const p=roomPlanSchema.parse(input);saved.current={id:p.id,revision,json:clean?JSON.stringify(p):''};preview(p);setSaveState(clean?'已保存':'未保存');setSelected(null);setWall(null);setPathIndex(null);setCursor(null);setLengthEntry(null);setTool('select');history.current=[];future.current=[];refreshHistory(v=>v+1);fit(p);setError('');}
  const save=useCallback(async()=>{
    while(saving.current)await saving.current;
    const current=planRef.current;if(!current||saved.current.json===JSON.stringify(current))return;
    const operation=(async()=>{
      setSaveState('保存中…');
      try {
        const response=await api<StoredPlan>('/rooms/'+current.id,{method:'PUT',body:JSON.stringify({plan:current,revision:saved.current.id===current.id?saved.current.revision:0})});
        if(planRef.current?.id===current.id){saved.current={id:current.id,revision:response.revision,json:JSON.stringify(current)};if(mounted.current){setSaveState(same(planRef.current,current)?'已保存':'未保存');setPlans(old=>[{id:current.id,name:current.name,updatedAt:response.updatedAt},...old.filter(p=>p.id!==current.id)]);}}
      }catch(e){if(mounted.current){setSaveState('保存失败');setError(message(e));}throw e;}
    })();
    saving.current=operation;try{await operation;}finally{if(saving.current===operation)saving.current=null;}
  },[]);
  useEffect(()=>{
    mounted.current=true;let live=true;
    (async()=>{try{const [list,lib]=await Promise.all([api<{plans:PlanSummary[]}>('/rooms'),api<{modules:FurnitureModule[]}>('/room-modules')]);if(!live)return;setPlans(list.plans);setModules(lib.modules);if(list.plans.length){const stored=await api<StoredPlan>('/rooms/'+list.plans[0].id);if(live)adopt(stored.plan,stored.revision,true);}else adopt(newPlan());}catch(e){if(live)setError(message(e));}finally{if(live)setLoading(false);}})();
    return()=>{live=false;mounted.current=false;nativeMessage({action:'room-dirty',dirty:false});};
  },[]);
  useEffect(()=>{
    if(!plan || loading || interacting)return;
    const dirty=JSON.stringify(plan)!==saved.current.json;
    if(dirty)setSaveState('未保存');
    const timer=setTimeout(()=>{if(dirty)void save().catch(()=>{});},650);return()=>clearTimeout(timer);
  },[plan,loading,interacting,save]);
  useEffect(()=>{
    nativeMessage({action:'room-dirty',dirty:interacting||saveState!=='已保存'});
    const bridge=(window as any).chrome?.webview;
    const listener=async({data}:{data:{type:string}})=>{
      if(data.type==='room-close-request'){
        if(gesture.current){setError('请先结束当前拖动');nativeMessage({action:'room-close-cancel'});return;}
        (document.activeElement as HTMLElement|null)?.blur();
        try{await save();nativeMessage({action:'room-close-ready'});}catch{nativeMessage({action:'room-close-cancel'});}
      }
      if(data.type==='exported')setSaveState('已保存');
    };
    bridge?.addEventListener('message',listener);return()=>bridge?.removeEventListener('message',listener);
  },[interacting,tool,saveState,save]);
  useEffect(()=>{
    const beforeLogout=(event:Event)=>{
      const detail=(event as CustomEvent<{pending:Promise<void>}>).detail;
      detail.pending=(async()=>{if(gesture.current)throw new Error('请先结束当前拖动');(document.activeElement as HTMLElement|null)?.blur();await save();})();
    };
    window.addEventListener('room-before-logout',beforeLogout);return()=>window.removeEventListener('room-before-logout',beforeLogout);
  },[tool,save]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;
    let initial=true;
    const observer=new ResizeObserver(()=>{setSize({w:el.clientWidth||600,h:el.clientHeight||560});if(initial&&planRef.current){fit(planRef.current);initial=false;}});observer.observe(el);
    const wheel=(e:WheelEvent)=>{e.preventDefault();const r=el.getBoundingClientRect(),old=viewRef.current,w=Math.max(1200,Math.min(100000,old.w*Math.exp(e.deltaY*.001))),fx=(e.clientX-r.left)/r.width,fy=(e.clientY-r.top)/r.width;setView({x:old.x+(old.w-w)*fx,y:old.y+(old.w-w)*fy,w});};
    el.addEventListener('wheel',wheel,{passive:false});return()=>{observer.disconnect();el.removeEventListener('wheel',wheel);};
  },[loading]);
  function world(clientX:number,clientY:number){const svg=canvas.current!,matrix=svg.getScreenCTM();if(matrix){const point=svg.createSVGPoint();point.x=clientX;point.y=clientY;const world=point.matrixTransform(matrix.inverse());return {x:world.x,y:world.y};}const r=svg.getBoundingClientRect(),v=viewRef.current;return {x:v.x+(clientX-r.left)*v.w/r.width,y:v.y+(clientY-r.top)*v.w/r.width};}
  function overCanvas(e:{clientX:number;clientY:number}){const r=canvas.current?.getBoundingClientRect();return !!r&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;}
  useEffect(()=>{
    const move=(e:PointerEvent)=>{
      const g=gesture.current;if(!g||!canvas.current)return;
      if(g.type==='pan'){const r=canvas.current.getBoundingClientRect();setView({...g.view,x:g.view.x-(e.clientX-g.start.x)*g.view.w/r.width,y:g.view.y-(e.clientY-g.start.y)*g.view.w/r.width});return;}
      if(g.type==='vertex'){
        const raw=world(e.clientX,e.clientY),vertices=g.path===null?g.before.room.vertices:g.before.room.paths[g.path];
        const hit=snapDrawingPoint(raw,vertices.filter((_,i)=>i!==g.index).map(p=>({points:[p],closed:false})),{threshold:12*scaleRef.current,grid:settings.current.grid&&!e.altKey,snap:settings.current.snap&&!e.altKey,ortho:false});
        const updated=vertices.map((p,i)=>i===g.index?hit.point:p);
        const next={...g.before,room:{...g.before.room,...(g.path===null?{vertices:updated}:{paths:g.before.room.paths.map((p,i)=>i===g.path?updated:p)})}};
        // Permit a temporary invalid outline while dragging; validate on release.
        preview(next);setGuides(hit.guides.map(g=>({...g,kind:'wall'})));return;
      }
      if(g.type==='rotate'){
        const p=world(e.clientX,e.clientY);if(distance(p,g.center)<10*scaleRef.current)return;
        const result=snapAngle(g.initial+(Math.atan2(p.y-g.center.y,p.x-g.center.x)-g.startAngle)*180/Math.PI,settings.current.angleSnap&&!e.altKey);
        const next=g.id?{...g.before,furniture:g.before.furniture.map(f=>f.id===g.id?{...f,rotation:result.angle}:f)}:rotateRoom(g.before,result.angle,g.withFurniture);
        const valid=roomPlanSchema.safeParse(next);if(valid.success){preview(valid.data);setRotationHint(result);setError('');}else setError('旋转后超出绘图范围');return;
      }
      const p=world(e.clientX,e.clientY),before=g.before,item=g.type==='palette'?g.item:before.furniture.find(f=>f.id===g.id)!;
      const positioned={...item,x:p.x-(g.type==='move'?g.offset.x:0),y:p.y-(g.type==='move'?g.offset.y:0)};
      positioned.x=Math.max(-49000,Math.min(49000,positioned.x));positioned.y=Math.max(-49000,Math.min(49000,positioned.y));
      const result=snapFurniture(positioned,before.room.vertices,before.furniture,Math.min(200,12*scaleRef.current),settings.current.grid,settings.current.snap&&!e.altKey);
      setGuides(result.guides);
      if(g.type==='palette')setGhost(overCanvas(e)?result.item:null);
      else preview({...before,furniture:before.furniture.map(f=>f.id===g.id?result.item:f)});
    };
    const end=(e:PointerEvent)=>{
      const g=gesture.current;if(!g)return;
      if(g.type==='move'||g.type==='rotate'||g.type==='vertex'){
        const current=planRef.current;
        if(current){const check=roomPlanSchema.safeParse(current);if(!check.success){preview(g.before);setError(check.error.issues[0].message);}else if(!same(g.before,current)){history.current=[...history.current.slice(-79),g.before];future.current=[];refreshHistory(v=>v+1);setError('');}}
      }
      if(g.type==='palette'&&overCanvas(e)){
        const p=world(e.clientX,e.clientY),s=snapFurniture({...g.item,x:p.x,y:p.y},g.before.room.vertices,g.before.furniture,Math.min(200,12*scaleRef.current),settings.current.grid,settings.current.snap&&!e.altKey);
        commit({...g.before,furniture:[...g.before.furniture,s.item]},g.before);setSelected(s.item.id);setWall(null);
      }
      gesture.current=null;setInteracting(false);setGhost(null);setGuides([]);setRotationHint(null);
    };
    const cancel=()=>{const g=gesture.current;if(g&&g.type!=='pan')preview(g.before);gesture.current=null;space.current=false;setInteracting(false);setGhost(null);setGuides([]);setRotationHint(null);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
    return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);};
  },[]);
  function undo(){setLengthEntry(null);setCursor(null);if(!planRef.current||!history.current.length)return;future.current.push(planRef.current);preview(history.current.pop()!);setSelected(null);setWall(null);setPathIndex(null);refreshHistory(v=>v+1);}
  function redo(){setLengthEntry(null);setCursor(null);if(!planRef.current||!future.current.length)return;history.current.push(planRef.current);preview(future.current.pop()!);setSelected(null);setWall(null);setPathIndex(null);refreshHistory(v=>v+1);}
  function editItem(values:Partial<Furniture>){if(!plan||!selected)return;commit({...plan,furniture:plan.furniture.map(f=>f.id===selected?{...f,...values}:f)});}
  function setRoomAngle(angle:number){if(!plan||!plan.room.vertices.length||tool==='draw')return;const next=rotateRoom(plan,angle,withFurniture);commit(next);if(roomPlanSchema.safeParse(next).success)fit(next);}
  function removeItem(){
    if(!plan)return;
    if(selected)commit({...plan,furniture:plan.furniture.filter(f=>f.id!==selected)});
    else if(wall!==null)commit(removeWallSegment(plan,pathIndex,wall));
    setSelected(null);setWall(null);setPathIndex(null);
  }
  function editWallPoint(index:number,point:Point){
    if(!plan)return;
    const room=plan.room;
    commit({...plan,room:{...room,...(pathIndex===null?{vertices:room.vertices.map((p,i)=>i===index?point:p)}:{paths:room.paths.map((p,i)=>i===pathIndex?p.map((v,j)=>j===index?point:v):p)})}});
  }
  function duplicate(){const f=plan?.furniture.find(f=>f.id===selected);if(!plan||!f)return;const copied={...f,id:crypto.randomUUID(),x:f.x+150,y:f.y+150};commit({...plan,furniture:[...plan.furniture,copied]});setSelected(copied.id);}
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){
        if(gesture.current){const g=gesture.current;if(g.type!=='pan')preview(g.before);gesture.current=null;setInteracting(false);setGhost(null);setGuides([]);setRotationHint(null);}
        if(moduleName!==null){setModuleName(null);return;}
        if(tool==='draw'){e.preventDefault();endDrawing();return;}
        setSelected(null);setWall(null);setPathIndex(null);return;
      }
      if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;
      if(e.code==='Space'){e.preventDefault();space.current=true;}
      if(gesture.current)return;
      if(tool==='draw'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
        if(e.key==='Tab'&&draft.length){e.preventDefault();beginLength();return;}
        if(e.key==='Backspace'||e.key.toLowerCase()==='u'){e.preventDefault();setDraft(draft.slice(0,-1));setLengthEntry(null);return;}
        if(e.key.toLowerCase()==='c'){e.preventDefault();finishDraft();return;}
        if(e.key==='Enter'){e.preventDefault();endDrawing();return;}
      }
      if(e.key==='F8'){e.preventDefault();setOrtho(v=>!v);}
      if(e.key==='F3'){e.preventDefault();setSnap(v=>!v);}
      if(e.key==='F9'){e.preventDefault();setGrid(v=>!v);}
      if(e.key==='Alt')setBypassSnap(true);
      if(e.ctrlKey && e.key.toLowerCase()==='s'){e.preventDefault();void save().catch(()=>{});}
      if(e.ctrlKey && e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
      if(e.ctrlKey && e.key.toLowerCase()==='y'){e.preventDefault();redo();}
      if(e.ctrlKey && e.key.toLowerCase()==='d'){e.preventDefault();duplicate();}
      if(e.key==='Delete')removeItem();
      const item=plan?.furniture.find(f=>f.id===selected);
      if(e.key.toLowerCase()==='r'&&tool!=='draw'){if(item)editItem({rotation:normalizeAngle(item.rotation+(e.shiftKey?-90:90))});else if(plan)setRoomAngle(plan.room.rotation+(e.shiftKey?-90:90));}
      if(item && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const step=e.shiftKey?100:10;editItem({x:item.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y:item.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)});}
    };
    const up=(e:KeyboardEvent)=>{if(e.code==='Space')space.current=false;if(e.key==='Alt')setBypassSnap(false);};window.addEventListener('keydown',down);window.addEventListener('keyup',up);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);};
  },[plan,selected,wall,pathIndex,moduleName,save,tool,withFurniture,cursor,grid,snap,ortho,bypassSnap,lengthEntry]);
  function drawingHit(p:Point,alt=bypassSnap){
    return snapDrawingPoint(p,[{points:draft,closed:false},{points:plan?.room.vertices??[],closed:true},...(plan?.room.paths??[]).map(points=>({points,closed:false}))],{last:draft.at(-1),threshold:12*scale,grid:grid&&!alt,snap:snap&&!alt,ortho});
  }
  function beginLength(){
    const last=draft.at(-1);if(!last)return;
    const current=cursorRef.current,toward=current?drawingHit(current).point:{x:last.x+1000,y:last.y};
    setLengthEntry({value:String(Math.max(100,Math.round(distance(last,toward)))),toward});
  }
  function submitLength(){
    if(!lengthEntry||!draft.length)return;
    const n=Number(lengthEntry.value);
    if(!lengthEntry.value.trim()||!Number.isFinite(n)||n<100||n>50000){setError('墙长范围为 100～50000 mm');return;}
    if(addDraft(measuredPoint(draft.at(-1)!,lengthEntry.toward,n),true)){setLengthEntry(null);canvas.current?.focus();}
  }
  function finishDraft(points=draft,paths=plan?.room.paths??[]){
    if(!plan)return false;
    const error=polygonError(points);if(error){setError(error);return false;}
    const next={...plan,room:{...plan.room,vertices:points,paths,draft:[],rotation:0}};const check=roomPlanSchema.safeParse(next);if(!check.success){setError(check.error.issues[0].message);return false;}
    commit(next);setLengthEntry(null);setCursor(null);setTool('select');setWall(null);setPathIndex(null);
    return true;
  }
  function addDraft(p:Point,precise=false){
    if(draft.length>=3&&distance(p,draft[0])<.01)return finishDraft();
    const joined=joinWallStroke(plan!.room.paths,[...draft,p]);
    if(joined.closed)return finishDraft(joined.points,joined.paths);
    if(draft.length>=64){setError('最多绘制 64 个顶点');return false;}
    const next={...plan!,room:{...plan!.room,draft:[...draft,p]}},check=roomPlanSchema.safeParse(next);
    if(!check.success){setError(Math.abs(p.x)>50000||Math.abs(p.y)>50000?'绘图范围为 ±50000 mm':check.error.issues[0].message);return false;}
    commit(next);if(precise)setCursor(null);return true;
  }
  function applyRectangle(){
    if(!plan)return;const width=Number(rectWidth),depth=Number(rectDepth);
    if(!Number.isFinite(width)||!Number.isFinite(depth)||width<500||depth<500||width>50000||depth>50000){setError('矩形宽深范围为 500～50000 mm');return;}
    const p={...plan,room:{...plan.room,vertices:rectangle(width,depth),draft:[],rotation:0}};commit(p);setWall(null);setPathIndex(null);fit(p);
  }
  function pointerDown(e:ReactPointerEvent<SVGSVGElement>){
    if(!plan||e.button===2)return;
    const target=e.target as Element,p=world(e.clientX,e.clientY);
    if(e.button===1||space.current||tool==='pan'){e.preventDefault();gesture.current={type:'pan',start:{x:e.clientX,y:e.clientY},view:{...view}};setInteracting(true);e.currentTarget.setPointerCapture(e.pointerId);return;}
    e.currentTarget.focus();
    if(tool==='draw'){if(lengthEntry)submitLength();else addDraft(drawingHit(p,e.altKey).point);return;}
    const vertex=target.getAttribute('data-vertex'),path=target.getAttribute('data-path');
    if(vertex!==null){const index=Number(vertex),pathId=path===null?null:Number(path);e.preventDefault();setSelected(null);setPathIndex(pathId);setWall(pathId===null?index:Math.min(index,plan.room.paths[pathId].length-2));gesture.current={type:'vertex',before:plan,index,path:pathId};setInteracting(true);e.currentTarget.setPointerCapture(e.pointerId);return;}
    const rotateId=target.closest('[data-rotate]')?.getAttribute('data-rotate');
    if(rotateId){e.preventDefault();const f=plan.furniture.find(f=>f.id===rotateId),center=f?{x:f.x,y:f.y}:roomCenter(plan.room.vertices);gesture.current={type:'rotate',before:plan,id:f?.id||null,center,startAngle:Math.atan2(p.y-center.y,p.x-center.x),initial:f?.rotation??plan.room.rotation,withFurniture};setInteracting(true);setRotationHint(null);e.currentTarget.setPointerCapture(e.pointerId);return;}
    const id=target.closest('[data-furniture]')?.getAttribute('data-furniture');
    if(id){const f=plan.furniture.find(f=>f.id===id)!;setSelected(id);setWall(null);setPathIndex(null);gesture.current={type:'move',before:plan,id,offset:{x:p.x-f.x,y:p.y-f.y}};setInteracting(true);e.currentTarget.setPointerCapture(e.pointerId);return;}
    const wallIndex=target.getAttribute('data-wall');setSelected(null);setWall(wallIndex===null?null:Number(wallIndex));setPathIndex(path===null?null:Number(path));
  }
  function startPalette(e:ReactPointerEvent<HTMLButtonElement>,template:PaletteItem){
    if(!plan||e.button!==0||tool==='draw')return;e.preventDefault();
    const {id:moduleId,...shape}=template;
    const item:Furniture={...shape,id:crypto.randomUUID(),x:0,y:0,...(moduleId?{moduleId}:{})};
    gesture.current={type:'palette',before:plan,item};setInteracting(true);setTool('select');e.currentTarget.setPointerCapture(e.pointerId);
  }
  async function switchPlan(id?:string){try{await save();if(id){const p=await api<StoredPlan>('/rooms/'+id);adopt(p.plan,p.revision,true);}else adopt(newPlan());}catch(e){setError(message(e));}}
  async function exportPlan(){if(!plan)return;try{await save();const data=JSON.stringify(plan,null,2);if((window as any).workboxNative)nativeMessage({action:'export',kind:'room',data});else{const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=plan.name+'.room.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(e){setError(message(e));}}
  async function importPlan(value:File){try{if(value.size>256*1024)throw new Error('方案文件不能超过 256 KB');const imported=roomPlanSchema.parse(JSON.parse(await value.text()));await save();adopt({...imported,id:crypto.randomUUID(),name:imported.name.slice(0,55)+' · 导入'});}catch(e){setError(e instanceof SyntaxError?'无法读取方案文件':message(e));}}
  async function saveModule(){const item=plan?.furniture.find(f=>f.id===selected);if(!item||!moduleName?.trim())return;setModuleBusy(true);try{const {x,y,moduleId,id,...shape}=item;const response=await api<{module:FurnitureModule}>('/room-modules',{method:'POST',body:JSON.stringify({...shape,id:crypto.randomUUID(),name:moduleName.trim()})});setModules(old=>[response.module,...old]);setLibrary('saved');setModuleName(null);}catch(e){setError(message(e));}finally{setModuleBusy(false);}}
  if(loading)return <div className="room-loading">正在打开方案…</div>;
  if(!plan)return <div className="room-loading" role="alert">{error||'无法打开方案'}<button onClick={()=>location.reload()}>重试</button></div>;
  const item=plan.furniture.find(f=>f.id===selected),r=plan.room.vertices,orientation=signedArea(r)>=0?1:-1;
  const outside=r.length?plan.furniture.filter(f=>!furnitureInside(f,r)):[],overlaps=plan.furniture.flatMap((a,i)=>plan.furniture.slice(i+1).filter(b=>overlap(a,b)).map(b=>[a,b]));
  const warningIds=new Set([...outside.map(f=>f.id),...overlaps.flat().map(f=>f.id)]);
  const palette:PaletteItem[]=library==='saved'?modules:Object.entries(furnitureCatalog).map(([kind,v])=>({...v,kind:kind as FurnitureKind,rotation:0}));
  const hit=cursor&&tool==='draw'&&!lengthEntry?drawingHit(cursor):null;
  const typedLength=lengthEntry?Number(lengthEntry.value):NaN;
  const transientPoint=lengthEntry&&draft.length&&Number.isFinite(typedLength)&&typedLength>=100&&typedLength<=50000?measuredPoint(draft.at(-1)!,lengthEntry.toward,typedLength):hit?.point??null;
  const inputAnchor=transientPoint??draft.at(-1);
  const inputPosition=inputAnchor?{left:Math.max(8,Math.min(size.w-140,(inputAnchor.x-view.x)/scale+18)),top:Math.max(10,Math.min(size.h-50,(inputAnchor.y-view.y)/scale+18))}:{};
  const editingPoints=pathIndex===null?r:plan.room.paths[pathIndex]??[];
  const wallEnd=wall===null?0:pathIndex===null?(wall+1)%r.length:wall+1;
  const wallA=wall===null?null:editingPoints[wall],wallB=wall===null?null:editingPoints[wallEnd];
  const center=roomCenter(r),localRoom=r.map(p=>rotatePoint(p,center,-plan.room.rotation)),roomTop=Math.min(...localRoom.map(p=>p.y-center.y));
  return <section className="room-app">
    <div className="room-filebar">
      <FolderOpen size={17}/><select aria-label="打开方案" value={plans.some(p=>p.id===plan.id)?plan.id:''} onChange={e=>void switchPlan(e.target.value)}><option value="" disabled>未保存方案</option>{plans.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>
      <button onClick={()=>void switchPlan()} title="新建方案"><Plus size={16}/>新建</button>
      <button onClick={()=>void save().catch(()=>{})} title="保存 · Ctrl+S"><Save size={16}/>保存</button>
      <button onClick={()=>file.current?.click()} disabled={tool==='draw'}><Upload size={16}/>导入</button><button onClick={()=>void exportPlan()}><Download size={16}/>导出</button>
      <input ref={file} type="file" hidden accept=".json,.room.json" onChange={e=>{const value=e.target.files?.[0];if(value)void importPlan(value);e.target.value='';}}/>
      <span className={'room-save-state '+(saveState==='保存失败'?'danger':'')}>{saveState}</span><span className="room-unit">2D · mm</span>
    </div>
    {error&&<div className="room-error" role="alert">{error}<button title="关闭提示" aria-label="关闭提示" onClick={()=>setError('')}><X size={14}/></button></div>}
    <div className="room-layout">
      <aside className="room-library room-pane">
        <h2>家具库</h2><div className="segments"><button className={library==='base'?'selected':''} onClick={()=>setLibrary('base')}>基础模板</button><button className={library==='saved'?'selected':''} onClick={()=>setLibrary('saved')}>我的模块</button></div>
        <div className="room-palette">{palette.map((p,i)=>{const Icon=kindIcon[p.kind];return <button key={p.id||p.kind} className="room-palette-card" aria-label={'拖入'+p.name} title="拖入画布" disabled={tool==='draw'} onPointerDown={e=>startPalette(e,p)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const b=bounds(r.length?r:[{x:view.x+view.w/2,y:view.y+view.w/aspect/2}]),{id,...shape}=p,added:Furniture={...shape,id:crypto.randomUUID(),x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2,...(id?{moduleId:id}:{})};commit({...plan,furniture:[...plan.furniture,added]});setSelected(added.id);setWall(null);}}}><Icon size={27}/><strong>{p.name}</strong><span>{p.width} × {p.depth} × {p.height}{p.rotation!==0&&<> · {p.rotation}°</>}</span></button>;})}</div>
        {!palette.length&&<p className="room-empty">暂无模块<br/>选中家具后可保存</p>}
        <div className="room-library-note">拖入画布 · 长 × 深 × 高</div>
        <h3>场景家具 <span>{plan.furniture.length}</span></h3><div className="room-object-list">{plan.furniture.map(f=><button key={f.id} className={selected===f.id?'selected':''} onClick={()=>{endDrawing('select');setSelected(f.id);}}><span>{f.name}</span><small>{warningIds.has(f.id)?'⚠':f.width+' × '+f.depth}</small></button>)}</div>
      </aside>
      <div className="room-editor">
        <div className="room-tools">
          <div className="room-tool-group">{([{id:'select',Icon:MousePointer2,label:'选择'},{id:'draw',Icon:PencilRuler,label:'画房间'},{id:'pan',Icon:Hand,label:'平移'}] as const).map(({id,Icon,label})=><button key={id} aria-pressed={tool===id} className={tool===id?'active':''} onClick={()=>endDrawing(id)}><Icon size={16}/>{label}</button>)}</div>
          <button title="撤销 · Ctrl+Z" aria-label="撤销" disabled={!history.current.length||interacting} onClick={undo}><Undo2 size={17}/></button><button title="重做 · Ctrl+Y" aria-label="重做" disabled={!future.current.length||interacting} onClick={redo}><Redo2 size={17}/></button>
          <button title="端点、中点、对齐和家具吸附 · F3 · Alt 临时关闭" aria-label="对象吸附" aria-pressed={snap} className={snap?'active':''} onClick={()=>setSnap(!snap)}><Magnet size={17}/></button><button title="50 mm 网格吸附 · F9" aria-label="网格吸附" aria-pressed={grid} className={grid?'active':''} onClick={()=>setGrid(!grid)}><Grid2X2 size={17}/></button>
          <button title="90° 倍数附近 5° 内吸附 · Alt 临时关闭" aria-label="角度吸附" aria-pressed={angleSnap} className={angleSnap?'active':''} onClick={()=>setAngleSnap(!angleSnap)}><RotateCw size={17}/></button>
        </div>
        {tool==='draw'&&<div className="room-drawbar"><label title="F8 切换"><input type="checkbox" checked={ortho} onChange={e=>setOrtho(e.target.checked)}/>正交</label><button disabled={!draft.length} onClick={beginLength}>输入长度 <kbd>Tab</kbd></button><button title="撤回墙边 · Backspace / U" aria-label="撤回墙边" disabled={!draft.length} onClick={()=>{setDraft(draft.slice(0,-1));setLengthEntry(null);}}><Undo2 size={16}/></button><button className="primary" disabled={draft.length<3} onClick={()=>finishDraft()}><Check size={16}/>闭合 <kbd>C</kbd></button><button onClick={()=>endDrawing()}>结束本段 <kbd>Esc</kbd></button></div>}
        <div className="room-canvas-wrap">
          <svg ref={canvas} className={'room-canvas mode-'+tool} role="application" aria-label="二维房间设计画布" tabIndex={0} viewBox={`${view.x} ${view.y} ${view.w} ${view.w/aspect}`} onPointerDown={pointerDown} onPointerMove={e=>{if(tool==='draw'&&!gesture.current&&!lengthEntry){setCursor(world(e.clientX,e.clientY));setBypassSnap(e.altKey);}}} onContextMenu={e=>e.preventDefault()}>
            <defs><pattern id="room-grid" width={grid?100:500} height={grid?100:500} patternUnits="userSpaceOnUse"><circle r={scale*.8} fill="var(--line)"/></pattern></defs>
            <rect x={view.x} y={view.y} width={view.w} height={view.w/aspect} fill="var(--bg)"/><rect x={view.x} y={view.y} width={view.w} height={view.w/aspect} fill="url(#room-grid)"/>
            {!!r.length&&<polygon className={'room-floor '+(tool==='draw'?'drawing':'')} points={r.map(p=>p.x+','+p.y).join(' ')}/>}
            {r.map((a,i)=>{const b=r[(i+1)%r.length];return <g key={i}><line className={'room-wall '+(pathIndex===null&&wall===i?'selected':'')} data-wall={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>{dimensions&&<Dimension a={a} b={b} offset={26*scale*orientation} scale={scale}/>}</g>;})}
            {plan.room.paths.map((points,path)=><g key={path} className="room-open-path" data-path-index={path}>
              {points.slice(0,-1).map((a,i)=>{const b=points[i+1];return <g key={i}><line className={'room-wall room-open-wall '+(pathIndex===path&&wall===i?'selected':'')} data-path={path} data-wall={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>{dimensions&&<Dimension a={a} b={b} offset={22*scale} scale={scale}/>}</g>;})}
              {tool==='select'&&!item&&pathIndex===path&&points.map((p,i)=><rect key={i} className="room-vertex" data-path={path} data-vertex={i} x={p.x-5*scale} y={p.y-5*scale} width={10*scale} height={10*scale}><title>拖动端点</title></rect>)}
            </g>)}
            {plan.furniture.map(f=><FurnitureShape key={f.id} item={f} selected={selected===f.id} warning={warningIds.has(f.id)} scale={scale}/>)}
            {item&&dimensions&&<><Dimension a={footprint(item)[0]} b={footprint(item)[1]} offset={17*scale} scale={scale}/><Dimension a={footprint(item)[1]} b={footprint(item)[2]} offset={17*scale} scale={scale}/></>}
            {ghost&&<FurnitureShape item={ghost} ghost scale={scale}/>}
            {guides.map((g,i)=><line key={i} className={'room-guide '+g.kind} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y}/>)}
            {tool==='select'&&item&&<RotationHandle center={item} top={-item.depth/2} angle={item.rotation} scale={scale} id={item.id} snapped={!!rotationHint?.snapped} onStep={delta=>editItem({rotation:normalizeAngle(item.rotation+delta)})}/>}
            {tool==='select'&&!item&&wall===null&&r.length>0&&<RotationHandle center={center} top={roomTop} angle={plan.room.rotation} scale={scale} id="room" snapped={!!rotationHint?.snapped} onStep={delta=>setRoomAngle(plan.room.rotation+delta)}/>}
            {tool==='select'&&!item&&pathIndex===null&&r.map((p,i)=><rect key={i} className="room-vertex" data-vertex={i} x={p.x-5*scale} y={p.y-5*scale} width={10*scale} height={10*scale}><title>拖动墙角</title></rect>)}
            {(draft.length>0||tool==='draw')&&<g className="room-sketch" pointerEvents="none"><polyline className="room-draft-lines" points={draft.map(p=>p.x+','+p.y).join(' ')}/>{draft.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r={(i===0?6:3)*scale}/>{i>0&&dimensions&&<Dimension a={draft[i-1]} b={p} offset={22*scale} scale={scale}/>}</g>)}{draft.length>0&&transientPoint&&<><line className="room-rubberband" x1={draft.at(-1)!.x} y1={draft.at(-1)!.y} x2={transientPoint.x} y2={transientPoint.y}/><Dimension a={draft.at(-1)!} b={transientPoint} offset={22*scale} scale={scale}/></>}</g>}
            {hit?.kind&&<g className="room-point-snap" pointerEvents="none">{hit.guides.map((g,i)=><line key={i} className="room-guide" x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y}/>)}{hit.kind==='midpoint'?<path d={`M${hit.point.x},${hit.point.y-7*scale} l${7*scale},${13*scale} h${-14*scale} Z`}/>:<rect x={hit.point.x-6*scale} y={hit.point.y-6*scale} width={12*scale} height={12*scale}/>}<text x={hit.point.x+12*scale} y={hit.point.y-12*scale} fontSize={11*scale}>{hit.kind==='endpoint'?(draft.length>=3&&distance(hit.point,draft[0])<.01?'起点 · 闭合':'端点'):hit.kind==='midpoint'?'中点':'对齐'}</text></g>}
          </svg>
          {lengthEntry&&<form className="room-dynamic-input" style={inputPosition} title="长度 · Enter 确定 · Esc 结束" onSubmit={e=>{e.preventDefault();submitLength();}}><input ref={lengthInput} aria-label="绘制长度 mm" type="number" min={100} max={50000} step="any" value={lengthEntry.value} onChange={e=>setLengthEntry({...lengthEntry,value:e.target.value})} onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();e.currentTarget.select();}}}/><span>mm</span></form>}
          {!r.length&&!draft.length&&!plan.room.paths.length&&tool!=='draw'&&<div className="room-blank"><PencilRuler size={30}/><button className="primary" onClick={()=>endDrawing('draw')}>绘制房间</button></div>}
          {tool==='draw'&&<div className="room-canvas-hint">{draft.length?'移动定方向 · Tab 输入长度 · 点击起点闭合':'点击设置起点'}</div>}
          {rotationHint&&<div className="room-canvas-hint">{rotationHint.angle}°{rotationHint.snapped?' · 已吸附':''} · Alt 自由旋转</div>}
        </div>
        <div className="room-status"><span>{r.length?(Math.abs(signedArea(r))/1e6).toFixed(2)+' m²':draft.length||plan.room.paths.length?'未闭合':'空白画布'} · {plan.furniture.length} 件家具</span><label><input type="checkbox" checked={dimensions} onChange={e=>setDimensions(e.target.checked)}/>尺寸</label><span className="room-status-help">滚轮缩放 · 中键平移</span><div className="room-zoom"><button title="缩小" aria-label="缩小" onClick={()=>setView(v=>({...v,w:Math.min(100000,v.w*1.2)}))}><ZoomOut size={17}/></button><button title="适应画布" aria-label="适应画布" onClick={()=>fit(plan)}><Scan size={17}/></button><button title="放大" aria-label="放大" onClick={()=>setView(v=>({...v,w:Math.max(1200,v.w/1.2)}))}><ZoomIn size={17}/></button></div></div>
      </div>
      <aside className="room-properties room-pane">
        {item?<><h2>{item.name}</h2><label className="room-field">家具名称<input aria-label="家具名称" maxLength={40} value={item.name} onChange={e=>{if(e.target.value.trim())editItem({name:e.target.value});}}/></label><div className="room-fields"><Numeric label="长度 mm" value={item.width} min={100} max={10000} onChange={width=>editItem({width})}/><Numeric label="进深 mm" value={item.depth} min={100} max={10000} onChange={depth=>editItem({depth})}/><Numeric label="高度 mm" value={item.height} min={100} max={5000} onChange={height=>editItem({height})}/><Numeric label="家具角度 °" value={item.rotation} min={-360} max={360} step={0.1} onChange={rotation=>editItem({rotation:normalizeAngle(rotation)})}/><Numeric label="中心 X mm" value={item.x} min={-50000} max={50000} onChange={x=>editItem({x})}/><Numeric label="中心 Y mm" value={item.y} min={-50000} max={50000} onChange={y=>editItem({y})}/></div><div className="room-item-actions"><button title="顺时针 90° · R" onClick={()=>editItem({rotation:normalizeAngle(item.rotation+90)})}><RotateCw size={16}/>90°</button><button title="复制 · Ctrl+D" onClick={duplicate}><Copy size={16}/>复制</button><button title="删除 · Delete" className="danger" onClick={removeItem}><Trash2 size={16}/>删除</button></div><button className="primary room-module-save" onClick={()=>setModuleName(item.name)}><Save size={16}/>保存为家具模块</button><p className="room-note">拖动圆柄旋转 · Alt 暂停吸附<br/>方向键移动 · R 旋转 90°</p></>:<><h2>{wall===null?'房间属性':'墙边 '+(wall+1)}</h2><label className="room-field">方案名称<input aria-label="方案名称" maxLength={60} value={plan.name} onChange={e=>{if(e.target.value.trim())commit({...plan,name:e.target.value});}}/></label>
        {wall!==null&&wallA&&wallB&&<div className="room-wall-properties"><Numeric label="墙长 mm" value={distance(wallA,wallB)} min={100} max={50000} step={0.1} onChange={length=>editWallPoint(wallEnd,measuredPoint(wallA,wallB,length))}/><span>终点坐标</span><div className="room-fields"><Numeric label="墙端 X mm" value={wallB.x} min={-50000} max={50000} onChange={x=>editWallPoint(wallEnd,{...wallB,x})}/><Numeric label="墙端 Y mm" value={wallB.y} min={-50000} max={50000} onChange={y=>editWallPoint(wallEnd,{...wallB,y})}/></div><div className="room-item-actions"><button className="danger" onClick={removeItem}><Trash2 size={16}/>删除线段</button>{pathIndex!==null&&editingPoints.length>=3&&<button onClick={()=>finishDraft(editingPoints,plan.room.paths.filter((_,i)=>i!==pathIndex))}>闭合为房间</button>}</div></div>}
        <div className="room-fields"><Numeric label="层高 mm" value={plan.room.height} min={1800} max={6000} onChange={height=>commit({...plan,room:{...plan.room,height}})}/><Numeric label="墙厚 mm" value={plan.room.wallThickness} min={50} max={600} onChange={wallThickness=>commit({...plan,room:{...plan.room,wallThickness}})}/></div>{r.length>0&&<div><h3>房间旋转</h3><Numeric label="房间角度 °" value={plan.room.rotation} min={-360} max={360} step={0.1} onChange={setRoomAngle}/><div className="room-rotate-actions"><button disabled={tool==='draw'||!r.length} onClick={()=>setRoomAngle(plan.room.rotation-90)}>↶ 90°</button><button disabled={tool==='draw'||!r.length} onClick={()=>setRoomAngle(plan.room.rotation+90)}>↷ 90°</button></div><label className="room-rotate-options"><input type="checkbox" checked={withFurniture} onChange={e=>setWithFurniture(e.target.checked)}/>家具随房间旋转</label></div>}<details className="room-rectangle"><summary>快速矩形</summary>{plan.room.legacyBoundary?.length&&<button className="secondary room-wide" disabled={tool==='draw'} onClick={()=>{const restored={...plan,room:{...plan.room,vertices:plan.room.legacyBoundary!,legacyBoundary:undefined}};commit(restored);fit(restored);}}>恢复旧版边界</button>}<form onSubmit={e=>{e.preventDefault();applyRectangle();}}><div className="room-fields"><label className="room-field">宽 mm<input type="number" aria-label="矩形宽 mm" min={500} max={50000} required value={rectWidth} onChange={e=>setRectWidth(e.target.value)}/></label><label className="room-field">深 mm<input type="number" aria-label="矩形深 mm" min={500} max={50000} required value={rectDepth} onChange={e=>setRectDepth(e.target.value)}/></label></div><button type="submit" className="secondary room-wide" disabled={tool==='draw'}>{r.length?'替换为矩形':'创建矩形'}</button></form></details><p className="room-note">墙边标注为室内净尺寸</p></>}
        <div className="room-assessment"><h3>布局检查</h3>{!r.length&&!warningIds.size?<p className="room-note">闭合房间后检查越界</p>:!warningIds.size?<p className="room-ok"><Check size={15}/>未发现越界或重叠</p>:<>{outside.map(f=><button key={f.id} onClick={()=>{setSelected(f.id);setWall(null);}}>{f.name} 超出房间</button>)}{overlaps.slice(0,10).map(([a,b])=><button key={a.id+b.id} onClick={()=>{setSelected(a.id);setWall(null);}}>{a.name} 与 {b.name} 重叠</button>)}</>}<small>按二维占地检查</small></div>
      </aside>
    </div>
    {moduleName!==null&&<div className="room-modal-backdrop"><form className="room-modal" onSubmit={e=>{e.preventDefault();void saveModule();}} role="dialog" aria-modal="true" aria-labelledby="module-title"><h2 id="module-title">保存家具模块</h2><label className="room-field">模块名称<input autoFocus aria-label="模块名称" maxLength={40} required value={moduleName} onChange={e=>setModuleName(e.target.value)}/></label><p>{item?.width} × {item?.depth} × {item?.height} mm · {item?.rotation}°</p><div><button type="button" onClick={()=>setModuleName(null)}>取消</button><button className="primary" disabled={moduleBusy||!moduleName.trim()}>{moduleBusy?'保存中…':'保存模块'}</button></div></form></div>}
  </section>;
}
