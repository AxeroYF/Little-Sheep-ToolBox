import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createApp } from '../server/app';
import { rectangle,newPlan,polygonError,polylineError,measuredPoint,snapDrawingPoint,signedArea,furnitureInside,overlap,footprint,bounds,snapFurniture,snapAngle,normalizeAngle,rotatePoint,rotateRoom,roomCenter,distance,roomPlanSchema,furnitureModuleSchema,toRoomScene,readStoredRoomPlan,endWallStroke,joinWallStroke,removeWallSegment,type Furniture } from '../shared/room';
const desk=(x=600,y=300):Furniture=>({id:randomUUID(),kind:'desk',name:'书桌',width:1200,depth:600,height:750,rotation:0,x,y});
const rectanglePlan=()=>{const p=newPlan();p.room.vertices=rectangle(4000,3000);return p;};

test('old starter boundary is retired reversibly, while explicit or edited rooms stay intact',()=>{
  const legacy=rectanglePlan();delete legacy.room.editorVersion;
  legacy.room.draft=[{x:650,y:550},{x:1600,y:550}];
  const opened=readStoredRoomPlan(legacy);
  assert.deepEqual(opened.room.vertices,[]);assert.deepEqual(opened.room.legacyBoundary,rectangle(4000,3000));
  assert.deepEqual(opened.room.paths,[legacy.room.draft]);assert.deepEqual(opened.room.draft,[]);
  assert.deepEqual(readStoredRoomPlan(opened),opened);assert.deepEqual(legacy.room.vertices,rectangle(4000,3000));
  for(const p of [rectanglePlan(),{...legacy,name:'卧室'}, {...legacy,furniture:[desk()]}, {...legacy,room:{...legacy.room,vertices:rectangle(4200,3000)}}])
    assert.deepEqual(readStoredRoomPlan(p).room.vertices,p.room.vertices);
  const restored={...opened,room:{...opened.room,vertices:opened.room.legacyBoundary!,legacyBoundary:undefined}};
  assert.deepEqual(readStoredRoomPlan(restored).room.vertices,rectangle(4000,3000));
});

test('ending strokes preserves confirmed geometry and new starts never connect to the previous endpoint',()=>{
  const p=newPlan();p.room.draft=[{x:0,y:0},{x:1000,y:0}];
  const ended=endWallStroke(p);assert.deepEqual(ended.room.draft,[]);assert.deepEqual(ended.room.paths,[p.room.draft]);
  const next={...ended,room:{...ended.room,draft:[{x:2000,y:1500}]}};
  assert.deepEqual(endWallStroke(next).room.paths,ended.room.paths);
  assert.deepEqual(joinWallStroke(ended.room.paths,next.room.draft).points,next.room.draft);
  assert.equal(roomPlanSchema.safeParse(ended).success,true);
});

test('independent endpoint-connected strokes form a room only after a real closing segment',()=>{
  const r=rectangle(4000,3000),paths=[[r[0],r[1]],[r[3],r[2]],[r[2],r[1]]];
  const joined=joinWallStroke(paths,[r[0],r[3]]);
  assert.equal(joined.closed,true);assert.equal(joined.paths.length,0);assert.equal(polygonError(joined.points),null);
  assert.equal(Math.abs(signedArea(joined.points)),12000000);
  assert.equal(joinWallStroke(paths,[r[0]]).closed,false);
  const unrelated=[{x:-2000,y:-2000},{x:-1000,y:-2000}];
  assert.deepEqual(joinWallStroke([...paths,unrelated],[r[0],r[3]]).paths,[unrelated]);
});

test('deleting one wall opens the room without inventing a replacement edge',()=>{
  const p=rectanglePlan(),opened=removeWallSegment(p,null,1);
  assert.deepEqual(opened.room.vertices,[]);assert.deepEqual(opened.room.paths,[[{x:4000,y:3000},{x:0,y:3000},{x:0,y:0},{x:4000,y:0}]]);
  const split=removeWallSegment(opened,0,1);assert.equal(split.room.paths.length,2);
  assert.deepEqual(split.room.paths,[[{x:4000,y:3000},{x:0,y:3000}],[{x:0,y:0},{x:4000,y:0}]]);
  assert.equal(roomPlanSchema.safeParse(split).success,true);
});

test('new canvas is empty, old closed plans remain intact and drafts validate independently',()=>{
  const p=newPlan();assert.deepEqual(p.room.vertices,[]);assert.deepEqual(toRoomScene(p).walls,[]);
  assert.equal(roomPlanSchema.safeParse(p).success,true);assert.deepEqual(roomCenter([]),{x:0,y:0});
  const old=rectanglePlan(),{draft,...room}=old.room;
  assert.deepEqual(roomPlanSchema.parse({...old,room}).room.vertices,rectangle(4000,3000));
  assert.deepEqual(roomPlanSchema.parse({...old,room}).room.draft,[]);
  p.room.draft=[{x:0,y:0},{x:4000,y:0},{x:4000,y:2500}];
  assert.equal(roomPlanSchema.safeParse(p).success,true);assert.deepEqual(toRoomScene(p).walls,[]);
  assert.ok(polylineError([{x:0,y:0},{x:1000,y:0},{x:-1000,y:0}]));
  assert.ok(polylineError([{x:0,y:0},{x:3000,y:3000},{x:3000,y:0},{x:0,y:3000}]));
  assert.ok(polylineError([{x:0,y:0},{x:99,y:0}]));
  assert.equal(roomPlanSchema.safeParse({...p,room:{...p.room,vertices:[{x:0,y:0}]}}).success,false);
});
test('CAD points prefer actual endpoints and midpoints over grid and orthogonal projection',()=>{
  const points=[{x:125,y:175},{x:3125,y:175},{x:3125,y:2175}];
  const options={last:points[2],threshold:80,grid:true,snap:true,ortho:true};
  assert.deepEqual(snapDrawingPoint({x:139,y:187},[{points,closed:false}],options).point,points[0]);
  const middle=snapDrawingPoint({x:1634,y:192},[{points,closed:false}],options);
  assert.equal(middle.kind,'midpoint');assert.deepEqual(middle.point,{x:1625,y:175});
  const alignment=snapDrawingPoint({x:135,y:2200},[{points,closed:false}],options);
  assert.equal(alignment.kind,'alignment');assert.deepEqual(alignment.point,{x:125,y:2175});
  const free=snapDrawingPoint({x:139,y:187},[{points,closed:false}],{...options,last:undefined,snap:false,grid:false});
  assert.equal(free.kind,null);assert.deepEqual(free.point,{x:139,y:187});
  // Screen-scaled tolerance: an object outside the aperture must not be grabbed.
  assert.notEqual(snapDrawingPoint({x:139,y:187},[{points,closed:false}],{...options,threshold:5}).kind,'endpoint');
});
test('typed lengths stay exact at any angle and can close to a non-grid start',()=>{
  const a={x:125,y:175};
  for(const toward of [{x:999,y:175},{x:-300,y:400},{x:125,y:-500}]){
    const p=measuredPoint(a,toward,1234.5);assert.ok(Math.abs(distance(a,p)-1234.5)<1e-6);
  }
  const points=[a];
  for(const [dx,dy,len] of [[1,0,3123],[0,1,2456],[-1,0,3123],[0,-1,2456]]){
    const last=points.at(-1)!;points.push(measuredPoint(last,{x:last.x+dx,y:last.y+dy},len));
  }
  assert.deepEqual(points.at(-1),a);assert.equal(polygonError(points.slice(0,-1)),null);
});

test('room geometry accepts L rooms, rejects crossing, retraced and tiny outlines',()=>{
  const l=[{x:0,y:0},{x:4000,y:0},{x:4000,y:1500},{x:2000,y:1500},{x:2000,y:3000},{x:0,y:3000}];
  assert.equal(polygonError(l),null);assert.equal(Math.abs(signedArea(l)),9000000);
  assert.ok(polygonError([{x:0,y:0},{x:3000,y:3000},{x:3000,y:0},{x:0,y:3000}]));
  assert.ok(polygonError([{x:0,y:0},{x:3000,y:0},{x:1000,y:0},{x:1000,y:2000},{x:0,y:2000}]));
  assert.ok(polygonError(rectangle(100,100)));
});
test('footprints rotate width and depth, edge contact is allowed and overlap is detected',()=>{
  const a=desk(),b=desk(1800,300);assert.equal(overlap(a,b),false);assert.equal(overlap(a,{...b,x:1790}),true);
  assert.deepEqual(bounds(footprint({...a,rotation:90})),{minX:300,maxX:900,minY:-300,maxY:900});
  assert.equal(furnitureInside(a,rectangle(4000,3000)),true);assert.equal(furnitureInside({...a,x:590},rectangle(4000,3000)),false);
});
test('concave boundary catches furniture bridging a notch even with corners inside',()=>{
  const u=[{x:0,y:0},{x:4000,y:0},{x:4000,y:4000},{x:2500,y:4000},{x:2500,y:2000},{x:1500,y:2000},{x:1500,y:4000},{x:0,y:4000}];
  assert.equal(furnitureInside({...desk(),x:2000,y:3000,width:3000,depth:500},u),false);
});
test('snapping reaches two walls exactly and behaves the same with reversed winding',()=>{
  const p=desk(615,320),room=rectangle(4000,3000);
  for(const vertices of [room,[...room].reverse()]){const result=snapFurniture(p,vertices,[],40,false,true);assert.equal(result.item.x,600);assert.equal(result.item.y,300);assert.equal(result.guides.filter(g=>g.kind==='wall').length,2);}
  assert.deepEqual(snapFurniture(p,room,[],40,false,false).item,p);
  const rotated=snapFurniture({...p,rotation:90,x:315,y:620},room,[],40,false,true).item;assert.equal(rotated.x,300);assert.equal(rotated.y,600);
});
test('furniture alignment, grid spacing and remote wall exclusion',()=>{
  const other=desk(2000,2000),near=desk(3210,2000),room=rectangle(10000,10000);
  assert.equal(snapFurniture(near,room,[other],30,false,true).item.x,3200);
  assert.equal(snapFurniture(desk(623,321),room,[],0,true,false).item.x,600);
  assert.equal(snapFurniture(desk(20000,315),room,[],40,false,true).item.y,315);
});
test('angle snapping crosses zero, supports precise angles and can be bypassed',()=>{
  for(const [angle,target] of [[-3,0],[358,0],[86,90],[184.9,180],[266,270],[721,0]])assert.deepEqual(snapAngle(angle),{angle:target,snapped:true});
  assert.deepEqual(snapAngle(84.9),{angle:84.9,snapped:false});assert.deepEqual(snapAngle(88.2,false),{angle:88.2,snapped:false});
  assert.equal(normalizeAngle(-90),270);assert.equal(normalizeAngle(360),0);
});
test('arbitrary rotations use oriented footprints rather than bounding boxes for overlap',()=>{
  const a={...desk(2000,2000),depth:200,rotation:45};
  const b={...a,id:randomUUID(),x:2000-300/Math.SQRT2,y:2000+300/Math.SQRT2};
  assert.equal(overlap(a,b),false);assert.equal(overlap(a,{...b,x:2000-100/Math.SQRT2,y:2000+100/Math.SQRT2}),true);
  const corners=footprint(a);assert.ok(Math.abs(distance(corners[0],corners[1])-1200)<1e-6);assert.ok(Math.abs(distance(corners[1],corners[2])-200)<1e-6);
  assert.equal(furnitureInside(a,rectangle(4000,4000)),true);assert.equal(furnitureInside({...a,x:200},rectangle(4000,4000)),false);
});
test('room rotation preserves wall lengths, area and relative furniture placement',()=>{
  const plan=rectanglePlan();plan.furniture=[desk()];const center=roomCenter(plan.room.vertices),rotated=rotateRoom(plan,33.3);
  assert.equal(rotated.room.rotation,33.3);assert.equal(rotated.furniture[0].rotation,33.3);assert.equal(furnitureInside(rotated.furniture[0],rotated.room.vertices),true);
  assert.ok(Math.abs(signedArea(plan.room.vertices)-signedArea(rotated.room.vertices))<0.001);
  for(let i=0;i<4;i++)assert.ok(Math.abs(distance(plan.room.vertices[i],plan.room.vertices[(i+1)%4])-distance(rotated.room.vertices[i],rotated.room.vertices[(i+1)%4]))<1e-6);
  assert.ok(distance(center,roomCenter(rotated.room.vertices))<1e-6);
  const restored=rotateRoom(rotated,0);for(let i=0;i<4;i++)assert.ok(distance(plan.room.vertices[i],restored.room.vertices[i])<1e-6);
  assert.deepEqual(rotateRoom(plan,90,false).furniture,plan.furniture);
});
test('rotated furniture snaps flush to rotated walls and a corner',()=>{
  const plan=rectanglePlan();plan.furniture=[desk(615,320)];
  for(const angle of [33.3,90,137]){
    const rotated=rotateRoom(plan,angle),expected=rotatePoint(desk(),roomCenter(plan.room.vertices),angle);
    for(const walls of [rotated.room.vertices,[...rotated.room.vertices].reverse()]){
      const result=snapFurniture(rotated.furniture[0],walls,[],40,false,true);
      assert.ok(distance(result.item,expected)<1e-6);assert.equal(result.guides.filter(g=>g.kind==='wall').length,2);assert.equal(furnitureInside(result.item,walls),true);
    }
  }
});
test('old plans default to zero orientation and modules retain arbitrary angles',()=>{
  const p=newPlan(),{rotation,...room}=p.room;assert.equal(roomPlanSchema.parse({...p,room}).room.rotation,0);
  const {x,y,...module}=desk();assert.equal(furnitureModuleSchema.parse({...module,rotation:27.5}).rotation,27.5);
  for(const rotation of [-1,360,Infinity])assert.equal(furnitureModuleSchema.safeParse({...module,rotation}).success,false);
});
test('plan import validates units, versions, dimensions, IDs and finite coordinates',()=>{
  const p=newPlan();assert.equal(roomPlanSchema.safeParse(p).success,true);
  for(const bad of [{...p,unit:'cm'},{...p,schemaVersion:2},{...p,furniture:[{...desk(),width:-10}]},{...p,room:{...p.room,vertices:[{x:Infinity,y:0},...p.room.vertices.slice(1)]}}])assert.equal(roomPlanSchema.safeParse(bad).success,false);
  const f=desk();assert.equal(roomPlanSchema.safeParse({...p,furniture:[f,f]}).success,false);
});
test('modules snapshot dimensions and 3D scene preserves height, axis and rotation',()=>{
  const f={...desk(),rotation:90 as const}, {x,y,...template}=f;
  const module=furnitureModuleSchema.parse(template);const placed={...module,id:randomUUID(),moduleId:module.id,x:1000,y:2000};
  placed.width=1600;assert.equal(module.width,1200);
  const p={...rectanglePlan(),furniture:[placed]},scene=toRoomScene(p);assert.deepEqual(scene.objects[0].size,[1600,750,600]);assert.deepEqual(scene.objects[0].position,[1000,375,2000]);assert.equal(scene.objects[0].rotationY,-Math.PI/2);assert.equal(scene.walls[0].height,2800);
});
test('room plans and reusable furniture persist, enforce ownership and reject stale saves',async()=>{
  const root=mkdtempSync(join(tmpdir(),'xiaoyang-room-test-')),dbPath=join(root,'test.sqlite');mkdirSync(join(root,'config'));writeFileSync(join(root,'config/apps.json'),JSON.stringify({schemaVersion:1,apps:[]}));
  const exe=join(root,'room.exe');writeFileSync(exe,'test');let launched='';
  const options={root,databasePath:dbPath,origin:'http://127.0.0.1:4457',platform:'win32',roomExe:exe,dataDir:root,launcher:async(entry:{path:string;args:string[]})=>{launched=entry.path;assert.deepEqual(entry.args,[`--data-dir=${root}`]);}};
  let app=await createApp(options);const h={host:'127.0.0.1:4457',origin:options.origin};
  const login=async(name='小羊')=>{const r=await app.inject({method:'POST',url:'/api/auth/login',headers:h,payload:{username:name,password:'Workbox-Local-Dev-2026!'}});assert.equal(r.statusCode,200);return {...h,cookie:String(r.headers['set-cookie']).split(';')[0]};};
  try {
    assert.equal((await app.inject({url:'/api/rooms',headers:h})).statusCode,401);
    assert.equal((await app.inject({url:'/api/room-modules',headers:h})).statusCode,401);
    const owner=await login(),p=newPlan();
    const catalog=(await app.inject({url:'/api/apps',headers:owner})).json().apps;assert.equal(catalog.find((v:any)=>v.id==='xiaoyang-room').installed,true);
    assert.equal((await app.inject({method:'POST',url:'/api/apps/xiaoyang-room/launch',headers:owner,payload:{path:'C:/bad.exe'}})).statusCode,200);assert.equal(launched,exe);
    const put=(plan=p,revision=0,headers=owner)=>app.inject({method:'PUT',url:'/api/rooms/'+plan.id,headers,payload:{plan,revision}});
    assert.equal((await put()).json().revision,1);assert.equal((await put()).statusCode,409);
    p.furniture=[{...desk(),rotation:37.5}];p.room.draft=[{x:125,y:175},{x:3125,y:175}];assert.equal((await put(p,1)).json().revision,2);
    const {x,y,...module}=p.furniture[0];assert.equal((await app.inject({method:'POST',url:'/api/room-modules',headers:owner,payload:module})).statusCode,200);
    const db=new Database(dbPath);db.prepare('INSERT INTO users SELECT ?,?,?,?,?,?').run(randomUUID(),'room_other','另一用户',(db.prepare('SELECT salt FROM users LIMIT 1').get() as any).salt,(db.prepare('SELECT passwordHash FROM users LIMIT 1').get() as any).passwordHash,Date.now());db.close();
    const other=await login('room_other');assert.deepEqual((await app.inject({url:'/api/rooms',headers:other})).json().plans,[]);assert.deepEqual((await app.inject({url:'/api/room-modules',headers:other})).json().modules,[]);
    assert.equal((await app.inject({url:'/api/rooms/'+p.id,headers:other})).statusCode,404);assert.equal((await put(p,2,other)).statusCode,404);
    assert.equal((await put({...p,room:{...p.room,vertices:rectangle(100,100)}},2)).statusCode,400);
    await app.close();app=await createApp(options);
    assert.equal((await app.inject({url:'/api/rooms/'+p.id,headers:owner})).json().plan.furniture[0].width,1200);
    assert.deepEqual((await app.inject({url:'/api/rooms/'+p.id,headers:owner})).json().plan.room,readStoredRoomPlan(p).room);
    assert.equal((await app.inject({url:'/api/room-modules',headers:owner})).json().modules[0].height,750);
    assert.equal((await app.inject({url:'/api/rooms/'+p.id,headers:owner})).json().plan.furniture[0].rotation,37.5);
    assert.equal((await app.inject({url:'/api/room-modules',headers:owner})).json().modules[0].rotation,37.5);
  }finally{await app.close();if(!resolve(root).startsWith(resolve(tmpdir())+'\\xiaoyang-room-test-'))throw new Error('Invalid test path');rmSync(root,{recursive:true,force:true});}
});
