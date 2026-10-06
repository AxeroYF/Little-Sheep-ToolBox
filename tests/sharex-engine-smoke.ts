import { createApp } from "../server/app";
import { resolve, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
mkdirSync(resolve("runtime"), { recursive: true });
const dataDir = mkdtempSync(resolve("runtime/sharex-engine-smoke-"));
const origin = "http://127.0.0.1:4340";
const app = await createApp({
  root: process.cwd(),
  databasePath: join(dataDir, "test.sqlite"),
  origin,
  dataDir,
  sharexSource: resolve("desktop-dev/components/ShareX-21.0.0"),
  captureBridge: resolve("desktop-dev/CaptureBridge.exe"),
});
const headers = { host: "127.0.0.1:4340", origin, cookie: "" };
const request = (url: string, body?: unknown) =>
  app.inject({
    method: body === undefined ? "GET" : "POST",
    url: "/api" + url,
    headers,
    payload: body as Record<string, unknown> | undefined,
  });
try {
  const login = await request("/auth/login", {
    username: "小羊",
    password: "Workbox-Local-Dev-2026!",
  });
  headers.cookie = String(login.headers["set-cookie"]).split(";")[0];
  const t = performance.now(),
    warm = await request("/screenshots/warmup", {}),
    warmupMs = Math.round(performance.now() - t);
  console.log("warmup", warm.statusCode, warm.body, warmupMs + "ms");
  assert.equal(warm.statusCode, 200);
  assert.equal(warm.json().ready, true);
  const results: { mode: string; visibleMs: number }[] = [];
  if(process.argv.includes("--full-screen")) {
    const start=await request("/screenshots/capture",{mode:"screen"});assert.equal(start.statusCode,200,start.body);
    let completed=false;
    for(let i=0;i<200;i++) {const state=(await request("/screenshots/status")).json();if(state.job.status==="failed")throw new Error(state.job.error);if(state.job.status==="complete"){const image=await request(`/screenshots/${state.job.imageId}/image`);assert.equal(image.statusCode,200);assert.equal(image.rawPayload.subarray(1,4).toString(),"PNG");completed=true;break;}await new Promise(r=>setTimeout(r,50));}
    assert.ok(completed,"real ShareX output imported with thumbnail");console.log("PASS: real full-screen capture, receipt, PNG import, thumbnail");
  }
  if (process.argv.includes("--capture"))
    for (const mode of ["region", "window", "region"]) {
      const start = await request("/screenshots/capture", { mode });
      assert.equal(start.statusCode, 200, start.body);
      let visibleMs = -1;
      for (let i = 0; i < 150; i++) {
        const state = (await request("/screenshots/status")).json();
        if (typeof state.activationMs === "number") {
          visibleMs = state.activationMs;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (visibleMs < 0)
        console.log("No surface:", (await request("/screenshots/status")).body);
      await request("/screenshots/cancel", {});
      assert.ok(visibleMs >= 0, "capture surface became visible");
      for (let i = 0; i < 100; i++) {
        if (!(await request("/screenshots/status")).json().busy) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      results.push({ mode, visibleMs });
    }
  const report = { warmupMs, results };
  writeFileSync(join(dataDir, "results.json"), JSON.stringify(report, null, 2));
  console.log("Results", JSON.stringify(report), dataDir);
} finally {
  await app.close();
}
