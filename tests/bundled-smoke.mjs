import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync,readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
const output = resolve("desktop-dev");
mkdirSync(resolve("runtime"), { recursive: true });
const data = mkdtempSync(resolve("runtime/bundled-smoke-"));
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = `http://127.0.0.1:${port}`,
  token = randomBytes(32).toString("hex"), nativeToken=randomBytes(32).toString('hex');
const headers = {
  "content-type": "application/json",
  origin,
  "x-workbox-desktop": token,
};
const service = spawn(
  join(output, "runtime/node.exe"),
  [join(output, "app/server.cjs")],
  {
    cwd: join(output, "app"),
    windowsHide: true,
    env: {
      ...process.env,
      WORKBOX_INITIAL_PASSWORD: "Workbox-Local-Dev-2026!",
      WORKBOX_PORT: String(port),
      WORKBOX_HOST: "127.0.0.1",
      WORKBOX_ORIGIN: origin,
      WORKBOX_DATABASE: join(data, "test.sqlite"),
      WORKBOX_DESKTOP_TOKEN: token,
      WORKBOX_NATIVE_FILES_TOKEN: nativeToken,
      WORKBOX_PARENT_PID: String(process.pid),
      WORKBOX_NETWORK_EXE: join(output, "小羊网络测试.exe"),
      WORKBOX_ROOM_EXE: join(output, "小羊房间设计.exe"),
      WORKBOX_PROBE_EXE: join(output, "NetworkProbe.exe"),
      WORKBOX_DATA_DIR: data,
      WORKBOX_SHAREX_SOURCE: join(output, "components/ShareX-21.0.0"),
      WORKBOX_CAPTURE_BRIDGE: join(output, "CaptureBridge.exe"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let errors = "";
service.stderr.on("data", (b) => (errors += b));
let cookie = "";
const api = async (path, body) => {
  const r = await fetch(origin + "/api" + path, {
    headers: { ...headers, cookie },
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  if (r.status >= 400) throw new Error(r.status + " " + JSON.stringify(value));
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return value;
};
const reports = [];
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await api("/health");
      ready = true;
      break;
    } catch {
      if (service.exitCode !== null) throw new Error(errors);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(ready, "bundled service ready");
  assert.equal((await fetch(origin + "/api/health")).status, 403);
  assert.equal((await fetch(origin + "/api/apps", { headers })).status, 401);
  assert.equal((await fetch(origin + "/", { headers })).status, 200);
  assert.equal(
    (
      await fetch(origin + "/api/auth/register", {
        method: "POST",
        headers,
        body: "{}",
      })
    ).status,
    403,
  );
  await api("/auth/login", {
    username: "小羊",
    password: "Workbox-Local-Dev-2026!",
  });
  const apps = await api("/apps");
  assert.equal(apps.apps.length, 8);
  assert.equal(apps.apps.find(t=>t.id==='xiaoyang-video').installed,true);
  assert.equal(apps.apps.find(t=>t.id==='xiaoyang-images').installed,true);
  assert.equal(apps.apps.find(t=>t.id==='xiaoyang-computer').installed,true);
  let computer=await api('/computer/snapshot');
  for(let i=0;i<40&&(!computer.sample||computer.history.length<2);i++){await new Promise(r=>setTimeout(r,250));computer=await api('/computer/snapshot');}
  assert.equal(computer.status,'live');assert.ok(computer.sample.memoryTotal>0);assert.ok(computer.history.length>=2);
  const computerSettings={hotkey:'Ctrl+Alt+M',mode:'mini',anchor:'bottom-left',opacity:.7,closeToTray:true};
  const setting=await fetch(origin+'/api/computer/settings',{method:'PUT',headers:{...headers,cookie,'x-workbox-native-files':nativeToken},body:JSON.stringify(computerSettings)});assert.equal(setting.status,200);assert.deepEqual(await api('/computer/settings'),computerSettings);
  writeFileSync(join(data,'computer.json'),JSON.stringify(computer,null,2));
  console.log('Packaged computer app: auto registration without host env, real CPU/RAM/GPU samples, native settings persistence passed');
  const packaged=createRequire(join(output,'app/server.cjs'));
  assert.ok(packaged.resolve('sharp').startsWith(join(output,'app/node_modules')));
  const sharp=packaged('sharp');
  assert.equal((await api('/ocr/status')).available,true);
  const ocrImage=await sharp(Buffer.from('<svg width="1000" height="250"><rect width="1000" height="250" fill="white"/><text x="40" y="140" font-family="Arial" font-size="64" fill="black">WORKBOX OCR 2026</text></svg>')).png().toBuffer();
  const ocrRequest=await fetch(origin+`/api/ocr/recognize?id=${randomUUID()}&language=eng&layout=block`,{method:'POST',headers:{...headers,cookie,'content-type':'application/octet-stream'},body:ocrImage});assert.equal(ocrRequest.status,202);
  let ocr=(await api('/ocr/status')).job;
  for(let i=0;i<60&&ocr.status==='running';i++){await new Promise(r=>setTimeout(r,200));ocr=(await api('/ocr/status')).job;}
  assert.equal(ocr.status,'complete',ocr.error);assert.match(ocr.text,/WORKBOX OCR 2026/);await new Promise(r=>setTimeout(r,100));assert.deepEqual(readdirSync(join(data,'ocr-temp')),[]);
  console.log('Packaged offline OCR: actual recognition and temporary cleanup passed');
  const imageBytes=await sharp({create:{width:48,height:32,channels:4,background:{r:20,g:130,b:240,alpha:0.5}}}).png().toBuffer();
  const imported=await fetch(origin+'/api/images/import?name=bundled.png',{method:'POST',headers:{...headers,cookie,'content-type':'application/octet-stream'},body:imageBytes});
  assert.equal(imported.status,200);const imageId=(await imported.json()).image.id;
  await api('/images/convert',{ids:[imageId],settings:{format:'avif',quality:85}});
  let imageState=await api('/images');
  for(let i=0;i<100&&imageState.job.status==='running';i++){await new Promise(r=>setTimeout(r,50));imageState=await api('/images');}
  assert.equal(imageState.job.status,'complete');
  const imageMeta=await sharp(join(imageState.outputDirectory,imageState.job.items[0].outputName)).metadata();
  assert.equal(imageMeta.width,48);assert.equal(imageMeta.height,32);assert.equal(imageMeta.format,'heif');
  console.log('Packaged image engine: actual AVIF conversion and app registration passed');
  const library=await api('/photos');assert.equal(library.rawAvailable,true);
  const rawImport=await fetch(origin+'/api/photos/import-paths',{method:'POST',headers:{...headers,cookie,'x-workbox-native-files':nativeToken},body:JSON.stringify({paths:[resolve('runtime/raw-fixtures/a7cii-compressed.ARW')]})});assert.equal(rawImport.status,202);
  let photoTask=(await api('/photos/status')).task;
  for(let i=0;i<200&&photoTask.status==='running';i++){await new Promise(r=>setTimeout(r,50));photoTask=(await api('/photos/status')).task;}
  assert.equal(photoTask.status,'complete');const photo=(await api('/photos')).photos[0];assert.equal(photo.metadata.camera,'ILCE-7CM2');
  const rendered=await fetch(origin+'/api/photos/'+photo.id+'/render',{method:'POST',headers:{...headers,cookie},body:'{}'});assert.equal(rendered.status,200);assert.equal((await sharp(Buffer.from(await rendered.arrayBuffer())).metadata()).width,1500);
  await api('/photos/export',{ids:[photo.id],format:'jpeg',longEdge:2048});
  for(let i=0;i<200;i++){photoTask=(await api('/photos/status')).task;if(photoTask.status!=='running')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(photoTask.status,'complete');assert.equal((await sharp(join(library.outputDirectory,photoTask.outputs[0].name)).metadata()).width,2048);
  console.log('Packaged RAW engine: A7C II import, real preview and 2048px export passed');
  assert.equal(apps.apps.find((t) => t.id === "xiaoyang-room").installed, true);
  assert.equal(apps.apps.find((t) => t.id === "xiaoyang-chess").installed, true);
  const roomPlan={schemaVersion:1,unit:'mm',id:randomUUID(),name:'空白画布验证',room:{vertices:[],draft:[{x:125,y:175},{x:3248,y:175}],height:2800,wallThickness:120,rotation:0},furniture:[]};
  const savedRoom=await fetch(origin+'/api/rooms/'+roomPlan.id,{method:'PUT',headers:{...headers,cookie},body:JSON.stringify({plan:roomPlan,revision:0})});
  assert.equal(savedRoom.status,200);
  assert.deepEqual((await api('/rooms/'+roomPlan.id)).plan,{...roomPlan,room:{...roomPlan.room,editorVersion:2,draft:[],paths:[roomPlan.room.draft]}});
  if (process.argv.includes("--launch-chess")) {
    assert.equal((await api("/apps/xiaoyang-chess/launch", {})).status, "requested");
    assert.equal((await api("/preferences")).recent[0].id, "xiaoyang-chess");
  }
  assert.equal(apps.apps.find((t) => t.id === "sharex").installed, true);
  assert.equal((await api("/apps/sharex/launch", {})).page, "screenshots");
  assert.equal(
    apps.apps.find((t) => t.id === "xiaoyang-network").installed,
    true,
  );
  const online = process.argv.includes("--online");
  const networkInfo = await api("/network/info");
  assert.equal(networkInfo.defaultNode, "nuaa");
  assert.deepEqual(networkInfo.nodes.map(n=>n.id), ["nuaa", "cloudflare"]);
  assert.ok(networkInfo.adapters.length > 0);
  assert.equal(typeof networkInfo.proxy.enabled, "boolean");
  const jobs = [
    { kind: "ping", target: "https://127.0.0.1/versus/" },
    { kind: "trace", target: "127.0.0.1/versus/" },
    ...(online
      ? [
          { kind: "dns", target: "cloudflare.com" },
          { kind: "tcp", target: "speed.cloudflare.com", port: 443 },
          { kind: "speed", target: "speed.cloudflare.com", nodeId: "cloudflare", mode: "quick" },
        ]
      : []),
  ];
  for (const input of jobs) {
    let { job } = await api("/network/jobs", input);
    const until = Date.now() + 90000;
    while (job.status === "running" && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 250));
      ({ job } = await api("/network/jobs/" + job.id));
    }
    assert.notEqual(job.status, "running");
    reports.push(job);
    console.log(JSON.stringify(job));
    if (["ping", "trace"].includes(input.kind)) {
      assert.equal(job.status, "complete");
      assert.equal(job.result.target, "127.0.0.1");
      if (input.kind === "ping") assert.equal(job.result.received, 10);
      else assert.equal(job.result.reached, true);
    }
  }
  const history = await api("/network/history");
  assert.equal(history.reports.length, reports.length);
  const legacyRoom = {schemaVersion:1,unit:"mm",id:randomUUID(),name:"未命名方案",
    room:{vertices:[{x:0,y:0},{x:4000,y:0},{x:4000,y:3000},{x:0,y:3000}],
      draft:[{x:650,y:550},{x:1600,y:550}],height:2800,wallThickness:120,rotation:0},furniture:[]};
  const roomSaved = await fetch(origin+"/api/rooms/"+legacyRoom.id,{method:"PUT",headers:{...headers,cookie},body:JSON.stringify({plan:legacyRoom,revision:0})});
  assert.equal(roomSaved.status,200);
  const upgraded = await api("/rooms/"+legacyRoom.id);
  assert.deepEqual(upgraded.plan.room.vertices,[]);
  assert.deepEqual(upgraded.plan.room.paths,[legacyRoom.room.draft]);
  assert.deepEqual(upgraded.plan.room.legacyBoundary,legacyRoom.room.vertices);
  const roomResaved=await fetch(origin+"/api/rooms/"+legacyRoom.id,{method:"PUT",headers:{...headers,cookie},body:JSON.stringify({plan:upgraded.plan,revision:upgraded.revision})});
  assert.equal(roomResaved.status,200);
  assert.deepEqual((await api("/rooms/"+legacyRoom.id)).plan,upgraded.plan);
  console.log("Room compatibility: default boundary retired reversibly; user lines preserved; save/reload stable");
  await api("/auth/logout", {});
  assert.equal(
    (await fetch(origin + "/api/apps", { headers: { ...headers, cookie } }))
      .status,
    401,
  );
  const exited = new Promise((r) => service.once("exit", r));
  await api("/desktop/shutdown", {});
  let timer;
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Shutdown timeout")), 4000);
    }),
  ]);
  clearTimeout(timer);
  writeFileSync(
    join(data, "results.json"),
    JSON.stringify({ built: true, reports, errors }, null, 2),
  );
  console.log("Report: " + join(data, "results.json"));
} finally {
  if (service.exitCode === null) service.kill();
}
