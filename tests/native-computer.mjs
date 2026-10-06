import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const run = resolve("runtime", "computer-native-" + Date.now());
mkdirSync(run, { recursive: true });
const output = join(run, "ComputerTests.exe");
execFileSync(
  join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
  [
    "/nologo",
    "/target:exe",
    "/main:ComputerTests",
    "/out:" + output,
    "/r:System.dll",
    "/r:System.Core.dll",
    "/r:System.Management.dll",
    "/r:System.Web.Extensions.dll",
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    resolve("tests/ComputerTests.cs"),
    resolve("desktop/ComputerProbe.cs"),
    resolve("desktop/HardwareTelemetry.cs"),
    resolve("desktop/ComputerOverlay.cs"),
  ],
  { stdio: "inherit" },
);
execFileSync(output, [run], { stdio: "inherit", windowsHide: true });
const probe = spawn(
  resolve("desktop-dev/ComputerProbe.exe"),
  ["--samples", "4", "--parent", String(process.pid)],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
);
let text = "",
  errors = "";
probe.stdout.on("data", (v) => (text += v));
probe.stderr.on("data", (v) => (errors += v));
const timeout = setTimeout(() => probe.kill(), 20000);
const code = await new Promise((r, j) => {
  probe.once("close", r);
  probe.once("error", j);
});
clearTimeout(timeout);
assert.equal(code, 0, errors);
const lines = text
    .trim()
    .split(/\r?\n/)
    .map((v) => JSON.parse(v.replace(/^\uFEFF/, ""))),
  info = lines.filter((v) => v.type === "info").at(-1)?.data,
  samples = lines.filter((v) => v.type === "sample").map((v) => v.data);
assert.ok(info?.cpu);
assert.equal(samples.length, 4);
assert.ok(
  samples.every(
    (s) =>
      s.cpu >= 0 &&
      s.cpu <= 100 &&
      s.memoryTotal > 0 &&
      s.memoryUsed <= s.memoryTotal,
  ),
);
assert.ok(samples[1].at - samples[0].at >= 900);
assert.ok(samples[1].networks.some((n) => n.receive !== null));
assert.equal(samples[1].processors.length, info.logicalProcessors);
assert.equal(new Set(samples[1].processors.map(p=>p.id)).size,info.logicalProcessors);
assert.ok(samples[1].processors.every(p=>p.usage===null||p.usage>=0&&p.usage<=100));
assert.ok(samples[1].disks.length>0);
writeFileSync(
  join(run, "results.json"),
  JSON.stringify({ info, samples }, null, 2),
);
console.log("Native probe and overlay checks passed: " + run);
const stopped = spawn(
  resolve("desktop-dev/ComputerProbe.exe"),
  ["--parent", String(process.pid)],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
);
stopped.stdout.resume();
stopped.stderr.resume();
const closed = new Promise((r, j) => {
  stopped.once("close", r);
  stopped.once("error", j);
});
stopped.stdin.end();
const stopTimer = setTimeout(() => stopped.kill(), 5000);
const stopCode = await closed;
clearTimeout(stopTimer);
assert.equal(stopCode, 0, "sampler exits cleanly when its owning pipe closes");
console.log("Sampler pipe-close cleanup passed");
