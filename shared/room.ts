import { z } from "zod";

export type Point = { x: number; y: number };
export type FurnitureKind = "desk" | "shelf" | "chair";
export const furnitureCatalog = {
  desk: { name: "书桌", width: 1200, depth: 600, height: 750 },
  shelf: { name: "书架", width: 800, depth: 300, height: 1800 },
  chair: { name: "椅子", width: 500, depth: 500, height: 850 },
} as const;
const coordinate = z.number().finite().min(-50000).max(50000);
const pointSchema = z.object({ x: coordinate, y: coordinate }).strict();
export const furnitureSchema = z.object({
  id: z.string().uuid(), kind: z.enum(["desk", "shelf", "chair"]),
  name: z.string().trim().min(1).max(40), x: coordinate, y: coordinate,
  width: z.number().int().min(100).max(10000), depth: z.number().int().min(100).max(10000),
  height: z.number().int().min(100).max(5000), rotation: z.number().finite().min(0).lt(360),
  moduleId: z.string().uuid().optional(),
  modelAssetId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,119}$/).optional(),
}).strict();
export type Furniture = z.infer<typeof furnitureSchema>;
export const furnitureModuleSchema = furnitureSchema.omit({x:true,y:true,moduleId:true});
export type FurnitureModule = z.infer<typeof furnitureModuleSchema>;
export const roomPlanSchema = z.object({
  schemaVersion: z.literal(1), unit: z.literal("mm"), id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  room: z.object({ vertices: z.array(pointSchema).max(64), draft: z.array(pointSchema).max(64).default([]), paths: z.array(z.array(pointSchema).min(2).max(64)).max(64).default([]), editorVersion: z.literal(2).optional(), legacyBoundary: z.array(pointSchema).max(64).optional(), height: z.number().int().min(1800).max(6000), wallThickness: z.number().int().min(50).max(600), rotation: z.number().finite().min(0).lt(360).default(0) }).strict(),
  furniture: z.array(furnitureSchema).max(150),
}).strict().superRefine((plan, ctx) => {
  const error = plan.room.vertices.length ? polygonError(plan.room.vertices) : null;
  if (error) ctx.addIssue({ code: "custom", message: error, path: ["room", "vertices"] });
  const draftError = polylineError(plan.room.draft);
  if (draftError) ctx.addIssue({ code: "custom", message: draftError, path: ["room", "draft"] });
  if (plan.room.paths.length + (plan.room.draft.length >= 2 ? 1 : 0) > 64)
    ctx.addIssue({ code: "custom", message: "最多保留 64 组线段", path: ["room", "paths"] });
  for (const [index, path] of plan.room.paths.entries()) {
    const error = polylineError(path);
    if (error) ctx.addIssue({ code: "custom", message: error, path: ["room", "paths", index] });
  }
  if (new Set(plan.furniture.map(f => f.id)).size !== plan.furniture.length)
    ctx.addIssue({ code: "custom", message: "家具 ID 重复", path: ["furniture"] });
});
export type RoomPlan = z.infer<typeof roomPlanSchema>;
export type StoredPlan = { plan: RoomPlan; revision: number; updatedAt: number };
export type PlanSummary = { id: string; name: string; updatedAt: number };
export function newPlan(): RoomPlan {
  return { schemaVersion: 1, unit: "mm", id: crypto.randomUUID(), name: "未命名方案", room: { vertices: [], draft: [], paths: [], editorVersion: 2, height: 2800, wallThickness: 120, rotation: 0 }, furniture: [] };
}
// Only the old, unchanged starter rectangle is retired. Keep its coordinates
// inside the plan so it can be restored; custom/imported/new rectangles stay.
export function readStoredRoomPlan(input: unknown): RoomPlan {
  const plan = roomPlanSchema.parse(input);
  const legacy = plan.room.editorVersion === undefined;
  const defaultBoundary = legacy && plan.name === '未命名方案' && !plan.furniture.length
    && plan.room.height === 2800 && plan.room.wallThickness === 120 && plan.room.rotation === 0
    && JSON.stringify(plan.room.vertices) === JSON.stringify(rectangle(4000, 3000));
  return {...plan, room: {...plan.room, editorVersion: 2,
    ...(defaultBoundary ? {vertices: [], legacyBoundary: plan.room.vertices} : {}),
    paths: [...plan.room.paths, ...(plan.room.draft.length >= 2 ? [plan.room.draft] : [])], draft: []}};
}
export function endWallStroke(plan: RoomPlan): RoomPlan {
  if (!plan.room.draft.length) return plan;
  return {...plan, room: {...plan.room, draft: [], paths: [...plan.room.paths,
    ...(plan.room.draft.length >= 2 ? [plan.room.draft] : [])]}};
}
// Connect only unambiguous matching endpoints. Merely snapping a new first
// point never resumes a previous command or inserts an extra segment.
export function joinWallStroke(paths: Point[][], stroke: Point[]): {paths: Point[][]; points: Point[]; closed: boolean} {
  let points = [...stroke]; const remaining = paths.map(p => [...p]);
  if (points.length < 2) return {paths: remaining, points, closed: false};
  const matches = (a: Point, b: Point) => distance(a,b) < .01;
  for (;;) {
    if (points.length >= 4 && matches(points[0],points.at(-1)!))
      return {paths: remaining, points: points.slice(0,-1), closed: true};
    const choices = remaining.flatMap((p,i) => [
      ...(matches(points.at(-1)!,p[0]) ? [{i,append:true,reverse:false}] : []),
      ...(matches(points.at(-1)!,p.at(-1)!) ? [{i,append:true,reverse:true}] : []),
      ...(matches(points[0],p.at(-1)!) ? [{i,append:false,reverse:false}] : []),
      ...(matches(points[0],p[0]) ? [{i,append:false,reverse:true}] : []),
    ]);
    const choice = choices.find(c => choices.filter(other => other.append === c.append).length === 1);
    if (!choice) return {paths: remaining, points, closed: false};
    const other = remaining.splice(choice.i,1)[0]; if (choice.reverse) other.reverse();
    points = choice.append ? [...points,...other.slice(1)] : [...other.slice(0,-1),...points];
  }
}
export function removeWallSegment(plan: RoomPlan, pathIndex: number | null, segment: number): RoomPlan {
  const room=plan.room, points=pathIndex===null?room.vertices:room.paths[pathIndex];
  if (!points || !points[segment]) return plan;
  if (pathIndex===null) {
    const opened=[...points.slice(segment+1),...points.slice(0,segment+1)];
    return {...plan,room:{...room,vertices:[],rotation:0,paths:[...room.paths,opened]}};
  }
  const pieces=[points.slice(0,segment+1),points.slice(segment+1)].filter(p=>p.length>=2);
  return {...plan,room:{...room,paths:room.paths.flatMap((p,i)=>i===pathIndex?pieces:[p])}};
}
export function rectangle(width: number, depth: number): Point[] { return [{x:0,y:0},{x:width,y:0},{x:width,y:depth},{x:0,y:depth}]; }
export function signedArea(p: Point[]) { return p.reduce((a, v, i) => { const n=p[(i+1)%p.length]; return a+v.x*n.y-n.x*v.y; },0)/2; }
export function distance(a: Point,b: Point) { return Math.hypot(a.x-b.x,a.y-b.y); }
function cross(a: Point,b: Point,c: Point) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
function onSegment(p: Point,a: Point,b: Point) { return Math.abs(cross(a,b,p))<0.01 && p.x>=Math.min(a.x,b.x)-0.01 && p.x<=Math.max(a.x,b.x)+0.01 && p.y>=Math.min(a.y,b.y)-0.01 && p.y<=Math.max(a.y,b.y)+0.01; }
function properIntersection(a:Point,b:Point,c:Point,d:Point) {
  const opposite=(x:number,y:number)=>(x>0.01&&y< -0.01)||(x< -0.01&&y>0.01);
  return opposite(cross(a,b,c),cross(a,b,d))&&opposite(cross(c,d,a),cross(c,d,b));
}
function intersects(a: Point,b: Point,c: Point,d: Point) {
  return properIntersection(a,b,c,d) || onSegment(c,a,b) || onSegment(d,a,b) || onSegment(a,c,d) || onSegment(b,c,d);
}
export function polygonError(vertices: Point[]): string | null {
  if (vertices.length<3) return "至少需要三条边";
  for(let i=0;i<vertices.length;i++) {
    const a=vertices[i], b=vertices[(i+1)%vertices.length];
    if(distance(a,b)<100) return "墙边长度不能小于 100 mm";
    const c=vertices[(i+2)%vertices.length];
    if(Math.abs(cross(a,b,c))<0.01 && (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)<0) return "墙边不能折返重叠";
    for(let j=i+1;j<vertices.length;j++) {
      if(j===i+1 || (i===0 && j===vertices.length-1)) continue;
      if(intersects(a,b,vertices[j],vertices[(j+1)%vertices.length])) return "墙边不能交叉或重叠";
    }
  }
  if(Math.abs(signedArea(vertices))<250000) return "房间面积不能小于 0.25 m²";
  return null;
}
export function bounds(vertices: Point[]) {
  if (!vertices.length) return {minX:0,minY:0,maxX:0,maxY:0};
  const xs=vertices.map(v=>v.x),ys=vertices.map(v=>v.y);
  return { minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys) };
}
export function normalizeAngle(angle: number) { return ((Math.round(angle*10)%3600)+3600)%3600/10; }
export function snapAngle(angle: number, enabled=true, threshold=5) {
  const normalized=normalizeAngle(angle), nearest=normalizeAngle(Math.round(normalized/90)*90);
  const delta=Math.abs(((normalized-nearest+540)%360)-180);
  return {angle:enabled&&delta<=threshold?nearest:normalized,snapped:enabled&&delta<=threshold};
}
export function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=point.x-center.x,y=point.y-center.y;
  return {x:Math.round((center.x+x*c-y*s)*1e9)/1e9,y:Math.round((center.y+x*s+y*c)*1e9)/1e9};
}
export function roomCenter(vertices: Point[]): Point {
  if (!vertices.length) return {x:0,y:0};
  let x=0,y=0,area=0;
  for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],c=a.x*b.y-b.x*a.y;area+=c;x+=(a.x+b.x)*c;y+=(a.y+b.y)*c;}
  if(Math.abs(area)<.01){const b=bounds(vertices);return {x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};}
  return {x:x/(3*area),y:y/(3*area)};
}
// Vertices are always world coordinates. The angle records the user's room
// orientation; consumers must not apply it to the vertices a second time.
export function rotateRoom(plan: RoomPlan, angle: number, withFurniture=true): RoomPlan {
  if (!plan.room.vertices.length) return plan;
  const rotation=normalizeAngle(angle),delta=rotation-plan.room.rotation,center=roomCenter(plan.room.vertices);
  return {...plan,room:{...plan.room,rotation,vertices:plan.room.vertices.map(p=>rotatePoint(p,center,delta))},furniture:withFurniture?plan.furniture.map(f=>({...f,...rotatePoint(f,center,delta),rotation:normalizeAngle(f.rotation+delta)})):plan.furniture};
}
// Open wall paths are saved independently; Escape never invents a closing wall.
export function polylineError(points: Point[]): string | null {
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i];
    if(distance(a,b)<100)return '墙边长度不能小于 100 mm';
    if(i>1){const prev=points[i-2];if(Math.abs(cross(prev,a,b))<.01&&(a.x-prev.x)*(b.x-a.x)+(a.y-prev.y)*(b.y-a.y)<0)return '墙边不能折返重叠';}
    for(let j=1;j<i-1;j++)if(intersects(a,b,points[j-1],points[j]))return '墙边不能交叉或重叠';
  }
  return null;
}
export type DrawingSnap = {point:Point;kind:'endpoint'|'midpoint'|'alignment'|null;guides:{a:Point;b:Point}[]};
export function snapDrawingPoint(raw:Point, paths:{points:Point[];closed:boolean}[], options:{last?:Point;threshold:number;grid:boolean;snap:boolean;ortho:boolean}):DrawingSnap {
  const {last,threshold,grid,snap,ortho}=options;
  // True object points take precedence over grid and orthogonal constraints.
  if(snap){
    const endpoints=paths.flatMap(p=>p.points).filter(p=>!last||distance(p,last)>.01);
    const midpoints=paths.flatMap(({points,closed})=>points.slice(0,closed?points.length:-1).map((a,i)=>{const b=points[(i+1)%points.length];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};}));
    for(const [kind,points] of [['endpoint',endpoints],['midpoint',midpoints]] as const){
      const candidate=points.filter(p=>distance(raw,p)<=threshold).sort((a,b)=>distance(raw,a)-distance(raw,b))[0];
      if(candidate)return {point:{...candidate},kind,guides:[]};
    }
  }
  const step=grid?50:1,point={x:Math.round(raw.x/step)*step,y:Math.round(raw.y/step)*step};
  const horizontal=!!last&&Math.abs(raw.x-last.x)>=Math.abs(raw.y-last.y);
  if(last&&ortho){if(horizontal)point.y=last.y;else point.x=last.x;}
  const guides:{a:Point;b:Point}[]=[];
  if(snap){
    const points=paths.flatMap(p=>p.points).filter(p=>!last||distance(p,last)>.01);
    for(const axis of ['x','y'] as const){
      if(last&&ortho&&axis===(horizontal?'y':'x'))continue;
      const candidate=points.filter(p=>Math.abs(p[axis]-raw[axis])<=threshold).sort((a,b)=>Math.abs(a[axis]-raw[axis])-Math.abs(b[axis]-raw[axis]))[0];
      if(candidate){point[axis]=candidate[axis];guides.push({a:candidate,b:point});}
    }
  }
  return {point,kind:guides.length?'alignment':null,guides};
}
export function measuredPoint(start:Point,toward:Point,length:number):Point {
  const d=distance(start,toward),dx=d?(toward.x-start.x)/d:1,dy=d?(toward.y-start.y)/d:0;
  // No grid or endpoint snapping here: typed lengths must remain exact.
  return {x:Math.round((start.x+dx*length)*1e9)/1e9,y:Math.round((start.y+dy*length)*1e9)/1e9};
}
export function footprint(f: Furniture) {
  const w=f.width,d=f.depth;
  return [{x:f.x-w/2,y:f.y-d/2},{x:f.x+w/2,y:f.y-d/2},{x:f.x+w/2,y:f.y+d/2},{x:f.x-w/2,y:f.y+d/2}].map(p=>rotatePoint(p,f,f.rotation));
}
export function inside(p: Point, polygon: Point[]) {
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if(onSegment(p,a,b)) return true;
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) result=!result;
  }
  return result;
}
export function furnitureInside(f: Furniture, room: Point[]) {
  const corners=footprint(f);
  if(!corners.every(p=>inside(p,room))) return false;
  // Split each furniture edge at room vertices projected onto it. Checking just
  // corners misses furniture bridging the cut-out of a concave room.
  for(let i=0;i<4;i++) {
    const a=corners[i],b=corners[(i+1)%4], dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
    const ts=[0,1,...room.map(p=>((p.x-a.x)*dx+(p.y-a.y)*dy)/len).filter(t=>t>0&&t<1)].sort((x,y)=>x-y);
    for(let j=1;j<ts.length;j++){const t=(ts[j-1]+ts[j])/2;if(!inside({x:a.x+dx*t,y:a.y+dy*t},room))return false;}
    for(let j=0;j<room.length;j++) { const c=room[j],d=room[(j+1)%room.length]; if(properIntersection(a,b,c,d))return false; }
  }
  return true;
}
export function overlap(a: Furniture,b: Furniture) {
  const pa=footprint(a),pb=footprint(b);
  // Separating-axis test: bounding boxes alone report false overlap once a
  // long desk is rotated. Touching edges remain valid placement.
  for(const p of [pa,pb])for(let i=0;i<2;i++){
    const edge={x:p[i+1].x-p[i].x,y:p[i+1].y-p[i].y},len=Math.hypot(edge.x,edge.y),nx=-edge.y/len,ny=edge.x/len;
    const x=pa.map(v=>v.x*nx+v.y*ny),y=pb.map(v=>v.x*nx+v.y*ny);
    if(Math.min(Math.max(...x),Math.max(...y))-Math.max(Math.min(...x),Math.min(...y))<=0.5)return false;
  }
  return true;
}
export type Guide = { a: Point; b: Point; kind: "wall" | "furniture" };
export function snapFurniture(item: Furniture, room: Point[], others: Furniture[], threshold: number, grid: boolean, snap: boolean): { item: Furniture; guides: Guide[] } {
  let result={...item}; const guides: Guide[]=[];
  if(grid) {result.x=Math.round(result.x/50)*50;result.y=Math.round(result.y/50)*50;}
  if(!snap)return {item:result,guides};
  // Align nearby parallel furniture edges, then give room boundaries priority.
  for(const axis of ["x","y"] as const) {
    let best=threshold+1, shift=0,guide:Guide|undefined;
    const f=bounds(footprint(result)),half=axis==='x'?(f.maxX-f.minX)/2:(f.maxY-f.minY)/2;
    for(const other of others.filter(v=>v.id!==item.id)) {
      const b=bounds(footprint(other)), targets=axis==='x'?[b.minX,b.maxX,other.x]:[b.minY,b.maxY,other.y];
      for(const v of targets)for(const edge of [result[axis]-half,result[axis],result[axis]+half]) {
        const delta=v-edge;
        if(Math.abs(delta)<=threshold && Math.abs(delta)<best){best=Math.abs(delta);shift=delta;guide=axis==='x'?{a:{x:v,y:Math.min(f.minY,b.minY)-200},b:{x:v,y:Math.max(f.maxY,b.maxY)+200},kind:'furniture'}:{a:{x:Math.min(f.minX,b.minX)-200,y:v},b:{x:Math.max(f.maxX,b.maxX)+200,y:v},kind:'furniture'};}
      }
    }
    if(guide){result[axis]+=shift;guides.push(guide);}
  }
  const orientation=signedArea(room)>=0?1:-1;
  const candidates=room.map((a,i)=>{const b=room[(i+1)%room.length],l=distance(a,b);return {a,b,l,tx:(b.x-a.x)/l,ty:(b.y-a.y)/l};});
  const used:number[]=[];
  for(let pass=0;pass<2;pass++) {
    let best=threshold+1, choice: {dx:number;dy:number;index:number}|undefined;
    candidates.forEach((wall,index)=>{
      if(used.some(u=>Math.abs(wall.tx*candidates[u].ty-wall.ty*candidates[u].tx)<0.1))return;
      const nx=-wall.ty*orientation,ny=wall.tx*orientation,corners=footprint(result);
      const radius=(x:number,y:number)=>Math.max(...corners.map(p=>Math.abs((p.x-result.x)*x+(p.y-result.y)*y)));
      const t=(result.x-wall.a.x)*wall.tx+(result.y-wall.a.y)*wall.ty,extent=radius(wall.tx,wall.ty);
      if(t+extent<0 || t-extent>wall.l)return;
      const d=(result.x-wall.a.x)*nx+(result.y-wall.a.y)*ny;
      const shift=radius(nx,ny)-d,previous=used.length?candidates[used[0]]:null;
      const factor=previous?shift/(nx*previous.tx+ny*previous.ty):shift;
      const dx=(previous?previous.tx:nx)*factor,dy=(previous?previous.ty:ny)*factor,amount=Math.hypot(dx,dy);
      if(amount<=threshold && amount<best){best=amount;choice={dx,dy,index};}
    });
    if(choice){const c=choice as {dx:number;dy:number;index:number};result.x+=c.dx;result.y+=c.dy;used.push(c.index);guides.push({...candidates[c.index],kind:'wall'});}
  }
  return {item:result,guides};
}
// Stable renderer contract: the 2D editor is only one consumer. A future 3D
// renderer can extrude walls and instantiate models without migrating plans.
export interface RoomScene {
  version: 1; unit: "mm"; floor: Point[];
  walls: { start: Point; end: Point; height: number; thickness: number }[];
  objects: { id: string; kind: FurnitureKind; position: [number,number,number]; size: [number,number,number]; rotationY: number; modelAssetId?: string }[];
}
export interface FurnitureModelAsset {
  id: string; provider: string; sourceUrl: string; author: string; license: "CC0-1.0";
  format: "glb"; relativeFile: string; naturalSizeMm: [number,number,number];
  pivot: "floor-center"; resizing: "bounds" | "parametric-parts";
}
export interface RoomRenderer3D { mount(container: HTMLElement): void; update(scene: RoomScene): void; dispose(): void; }
export function toRoomScene(plan: RoomPlan): RoomScene {
  return {version:1,unit:'mm',floor:plan.room.vertices.map(p=>({...p})),walls:plan.room.vertices.map((p,i)=>({start:{...p},end:{...plan.room.vertices[(i+1)%plan.room.vertices.length]},height:plan.room.height,thickness:plan.room.wallThickness})),objects:plan.furniture.map(f=>({id:f.id,kind:f.kind,position:[f.x,f.height/2,f.y],size:[f.width,f.height,f.depth],rotationY:-f.rotation*Math.PI/180,...(f.modelAssetId?{modelAssetId:f.modelAssetId}:{})}))};
}
