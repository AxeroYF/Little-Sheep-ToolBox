import { createApp } from "../server/app";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

mkdirSync(resolve("runtime"), {recursive:true});
const dataDir = mkdtempSync(resolve("runtime/capture-transition-"));
const fixture = join(dataDir,"CaptureTransitionTests.exe");
execFileSync(join(process.env.WINDIR!,"Microsoft.NET/Framework64/v4.0.30319/csc.exe"), ["/nologo","/target:exe","/out:"+fixture,"/r:System.Core.dll","/r:System.Drawing.dll","/r:System.Windows.Forms.dll","/win32manifest:"+resolve("desktop/app.manifest"),resolve("tests/CaptureTransitionTests.cs"),resolve("desktop/CaptureWindowTransition.cs")]);
const origin = "http://127.0.0.1:4341";
const app = await createApp({root:process.cwd(),databasePath:join(dataDir,"test.sqlite"),dataDir,origin,sharexSource:resolve("desktop-dev/components/ShareX-21.0.0"),captureBridge:resolve("desktop-dev/CaptureBridge.exe")});
const headers = {host:"127.0.0.1:4341",origin,cookie:""};
const request = (url:string, payload?:object)=>app.inject({method:payload===undefined?"GET":"POST",url:"/api"+url,headers,payload});
let host: ReturnType<typeof spawn> | undefined;
try {
  const login=await request("/auth/login",{username:"小羊",password:"Workbox-Local-Dev-2026!"});
  headers.cookie=String(login.headers["set-cookie"]).split(";")[0];
  assert.equal((await request("/screenshots/warmup",{})).json().ready,true);
  host=spawn(fixture,[],{stdio:["pipe","pipe","inherit"],windowsHide:true});
  const lines=createInterface({input:host.stdout!});
  const queued: string[]=[]; let waiting: ((line:string)=>void)|undefined;
  lines.on("line", line=>{if(waiting){const done=waiting;waiting=undefined;done(line);}else queued.push(line);});
  const next=async()=>{
    let timeout: ReturnType<typeof setTimeout>;
    const line=await Promise.race([new Promise<string>(ok=>{if(queued.length)ok(queued.shift()!);else waiting=ok;}),new Promise<never>((_,fail)=>{timeout=setTimeout(()=>fail(new Error("native test timed out")),10000);})]).finally(()=>clearTimeout(timeout));
    const event=JSON.parse(line);assert.ok(!event.error,line);return event;
  };
  assert.equal((await next()).ready,true);
  const command=async(value:string)=>{host!.stdin!.write(value+"\n");return next();};
  const capture=async(label:string)=>{
    // Dispatch immediately when the native preparation fence reports complete.
    const start=await request("/screenshots/capture",{mode:"screen"});assert.equal(start.statusCode,200,start.body);
    for(let i=0;i<200;i++) {
      const state=(await request("/screenshots/status")).json();
      assert.notEqual(state.job.status,"failed",state.job.error);
      if(state.job.status==="complete" && !state.busy) {
        const image=await request(`/screenshots/${state.job.imageId}/image`);
        const path=join(dataDir,label+".png");writeFileSync(path,image.rawPayload);
        return Number(execFileSync(fixture,[path],{encoding:"utf8",windowsHide:true}).trim());
      }
      await new Promise(r=>setTimeout(r,30));
    }
    throw new Error("capture did not finish");
  };
  const results=[];
  for(const mode of ["normal","maximized"]) {
    await command(mode);
    assert.ok(await capture(mode+"-before")>20000,"baseline must contain the visible test window");
    const prepared=await command("prepare");
    const pixels=await capture(mode+"-after");
    assert.equal(prepared.state,"Minimized");assert.equal(prepared.cloaked,0,"temporary cloak cleared");
    assert.ok(pixels<8,`${mode}: capture contains ${pixels} pixels of the minimizing test window`);
    results.push({mode,prepareMs:prepared.ms,windowPixels:pixels});
  }
  const minimized=await command("prepare");assert.equal(minimized.state,"Minimized");assert.equal(minimized.visible,true);
  await command("hidden");const hidden=await command("prepare");assert.equal(hidden.visible,false,"tray-hidden window must stay hidden");
  writeFileSync(join(dataDir,"results.json"),JSON.stringify({results,minimized,hidden},null,2));
  console.log("PASS: real ShareX captures after native minimization contain no window/animation pixels",JSON.stringify(results));
  console.log("Report:",join(dataDir,"results.json"));
} finally {host?.kill(); await app.close();}
