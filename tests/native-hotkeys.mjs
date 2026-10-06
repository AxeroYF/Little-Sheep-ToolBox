import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
mkdirSync(resolve("runtime"), { recursive: true });
const output = resolve("runtime/HotkeyTests.exe");
execFileSync(
  join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
  [
    "/nologo",
    "/target:exe",
    "/out:" + output,
    "/r:System.Windows.Forms.dll",
    "/r:System.Core.dll",
    resolve("tests/HotkeyTests.cs"),
    resolve("desktop/CaptureHotkey.cs"),
  ],
  { stdio: "inherit" },
);
execFileSync(output, [], { stdio: "inherit", windowsHide: true });
