import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {copyHardwareRuntime} from './hardware-runtime.mjs';
import {videoBuildArgs} from './video-runtime.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  output = join(root, "desktop-dev");
mkdirSync(output, { recursive: true });
copyHardwareRuntime(root, output);
const csc = join(
  process.env.WINDIR ?? "C:/Windows",
  "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
);
const common = [
  "/nologo",
  "/optimize+",
  "/platform:x64",
  "/r:System.dll",
  "/r:System.Core.dll",
  "/r:System.Web.Extensions.dll",
];
execFileSync(
  csc,
  [
    ...common,
    "/target:exe",
    `/out:${join(output, "ComputerProbe.exe")}`,
    "/r:System.Management.dll",
    `/win32manifest:${join(root, "desktop/app.manifest")}`,
    join(root, "desktop/ComputerProbe.cs"),
    join(root, "desktop/HardwareTelemetry.cs"),
  ],
  { stdio: "inherit" },
);
if(process.argv.includes('--probe-only')) { console.log('Built ComputerProbe and hardware runtime'); process.exit(0); }
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(root, "scripts/create-icons.ps1"),
  ],
  { stdio: "inherit" },
);
const target = join(output, "小羊电脑信息.exe");
if (existsSync(target)) {
  const backup = join(root, "runtime", "computer-host-before-" + Date.now());
  mkdirSync(backup, { recursive: true });
  copyFileSync(target, join(backup, "小羊电脑信息.exe"));
}
execFileSync(
  csc,
  [
    ...common,
    "/target:winexe",
    `/out:${target}`,
    ...videoBuildArgs(root),
    `/win32manifest:${join(root, "desktop/app.manifest")}`,
    `/win32icon:${join(root, "desktop/computer.ico")}`,
    ...["System.Windows.Forms", "System.Drawing", "System.IO.Compression"].map(
      (n) => `/r:${n}.dll`,
    ),
    ...["Core", "WinForms"].map(
      (n) => `/r:${join(output, "Microsoft.Web.WebView2." + n + ".dll")}`,
    ),
    ...[
      "Workbox",
      "CaptureHotkey",
      "CaptureWindowTransition",
      "ComputerNative",
      "ComputerOverlay",
    ].map((n) => join(root, "desktop", n + ".cs")),
  ],
  { stdio: "inherit" },
);
for (const name of ["小羊电脑信息.exe", "ComputerProbe.exe"])
  writeFileSync(
    join(output, name + ".config"),
    '<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup></configuration>',
  );
console.log("Built " + target);
