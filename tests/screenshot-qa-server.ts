import { resolve,join } from "node:path";
import { mkdtempSync,mkdirSync,writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import {randomUUID,createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import { createApp } from "../server/app";
// Manual integration QA only. Separate local database and gallery; never user data.
mkdirSync(resolve("runtime"),{recursive:true});
const dataDir=mkdtempSync(resolve("runtime/screenshots-qa-"));
const app=await createApp({root:process.cwd(),databasePath:join(dataDir,"test.sqlite"),origin:"http://127.0.0.1:4330",host:"127.0.0.1",platform:"win32",dataDir,networkExe:resolve("desktop-dev/小羊网络测试.exe"),probePath:resolve("desktop-dev/NetworkProbe.exe"),sharexSource:resolve("desktop-dev/components/ShareX-21.0.0"),captureBridge:resolve("desktop-dev/CaptureBridge.exe"),launcher:async()=>{}});
if(process.argv.includes("--fixture")) {
  const db=new Database(join(dataDir,"test.sqlite"));const owner=(db.prepare("SELECT id FROM users LIMIT 1").get() as {id:string}).id;
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=","base64");
  const id=randomUUID();const image=join(dataDir,"screenshots/originals",id+".png");writeFileSync(image,png);
  execFileSync(resolve("desktop-dev/CaptureBridge.exe"),["thumbnail",image,join(dataDir,"screenshots/thumbnails",id+".jpg")],{windowsHide:true});
  db.prepare("INSERT INTO screenshots (id,userId,jobId,title,createdAt,width,height,bytes,hash) VALUES (?,?,?,?,?,?,?,?,?)").run(id,owner,id,"界面验证截图",Date.now(),1,1,png.length,createHash("sha256").update(png).digest("hex"));db.close();
}
await app.listen({host:"127.0.0.1",port:4330});
writeFileSync(resolve("runtime/screenshots-qa-current.json"),JSON.stringify({dataDir,port:4330}));
console.log("Screenshot QA: http://127.0.0.1:4330; isolated data: "+dataDir);
for(const signal of ["SIGTERM","SIGINT"] as const)process.on(signal,()=>{void app.close().finally(()=>process.exit(0));});
