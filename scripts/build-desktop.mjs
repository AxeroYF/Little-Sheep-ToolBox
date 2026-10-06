import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  mkdirSync,
  cpSync,
  copyFileSync,
  existsSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { copyImageRuntime } from "./image-runtime.mjs";
import {copyOcrRuntime} from './ocr-runtime.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "desktop-dev");
const require = createRequire(import.meta.url);
const sdk =
  process.env.WORKBOX_WEBVIEW2_SDK ||
  join(homedir(), ".nuget/packages/microsoft.web.webview2/1.0.4022.49");
if (process.platform !== "win32")
  throw new Error("The desktop build requires Windows.");
if (!existsSync(join(sdk, "lib/net462/Microsoft.Web.WebView2.Core.dll")))
  throw new Error(
    "WebView2 SDK 1.0.4022.49 is required. Set WORKBOX_WEBVIEW2_SDK to its extracted NuGet package directory.",
  );
mkdirSync(join(output, "app"), { recursive: true });
mkdirSync(join(output, "runtime"), { recursive: true });
await build({
  entryPoints: [join(root, "server/index.ts")],
  outfile: join(output, "app/server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["better-sqlite3", "sharp"],
  logLevel: "warning",
});
const generatedUi = resolve(output, "app/dist");
if (dirname(generatedUi) !== resolve(root, "desktop-dev/app"))
  throw new Error("Invalid generated UI directory");
rmSync(generatedUi, { recursive: true, force: true });
cpSync(join(root, "dist"), generatedUi, { recursive: true });
cpSync(join(root, "config"), join(output, "app/config"), { recursive: true });
for (const pkg of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  const source = dirname(require.resolve(pkg + "/package.json"));
  const target = join(output, "app/node_modules", pkg);
  mkdirSync(target, { recursive: true });
  copyFileSync(join(source, "package.json"), join(target, "package.json"));
  if (pkg === "better-sqlite3") {
    cpSync(join(source, "lib"), join(target, "lib"), { recursive: true });
    mkdirSync(join(target, "build/Release"), { recursive: true });
    copyFileSync(
      join(source, "build/Release/better_sqlite3.node"),
      join(target, "build/Release/better_sqlite3.node"),
    );
  } else cpSync(source, target, { recursive: true });
  for (const license of ["LICENSE", "LICENSE.md"])
    if (existsSync(join(source, license)))
      copyFileSync(join(source, license), join(target, license));
}
copyImageRuntime(root, output);
execFileSync(process.execPath,[join(root,'scripts/build-raw-host.mjs')],{stdio:'inherit'});
copyFileSync(process.execPath, join(output, "runtime/node.exe"));
for (const name of [
  "Microsoft.Web.WebView2.Core.dll",
  "Microsoft.Web.WebView2.WinForms.dll",
])
  copyFileSync(join(sdk, "lib/net462", name), join(output, name));
copyFileSync(
  join(sdk, "runtimes/win-x64/native/WebView2Loader.dll"),
  join(output, "WebView2Loader.dll"),
);
const csc = join(
  process.env.WINDIR || "C:/Windows",
  "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
);
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
const {videoBuildArgs}=await import('./video-runtime.mjs');
const common = [
  "/nologo",
  "/optimize+",
  "/platform:x64",
  "/r:System.dll",
  "/r:System.Core.dll",
  "/r:System.Web.Extensions.dll",
];
for (const [name, icon] of [
  ["小羊工作箱", "workbox"],
  ["小羊网络测试", "network"],
  ["小羊房间设计", "room"],
  ["小羊图片工坊", "images"],
]) {
  execFileSync(
    csc,
    [
      ...common,
      "/target:winexe",
      `/out:${join(output, name + ".exe")}`,
      ...videoBuildArgs(root),
      `/win32manifest:${join(root, "desktop/app.manifest")}`,
      `/win32icon:${join(root, "desktop", icon + ".ico")}`,
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      "/r:System.IO.Compression.dll",
      `/r:${join(output, "Microsoft.Web.WebView2.Core.dll")}`,
      `/r:${join(output, "Microsoft.Web.WebView2.WinForms.dll")}`,
      join(root, "desktop/Workbox.cs"),
      join(root,"desktop/ComputerNative.cs"),
      join(root,"desktop/ComputerOverlay.cs"),
      join(root, "desktop/CaptureHotkey.cs"),
      join(root, "desktop/CaptureWindowTransition.cs"),
    ],
    { stdio: "inherit" },
  );
  writeFileSync(
    join(output, name + ".exe.config"),
    '<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup></configuration>',
  );
}
execFileSync(
  csc,
  [
    ...common,
    "/target:exe",
    `/out:${join(output, "NetworkProbe.exe")}`,
    join(root, "desktop/NetworkProbe.cs"),
  ],
  { stdio: "inherit" },
);
writeFileSync(
  join(output, "使用说明.txt"),
  "双击 小羊工作箱.exe。小羊网络测试、小羊房间设计、小羊图片工坊、小羊电脑信息也可独立打开。\r\n使用默认账号「小羊」登录。需要 Windows 10/11 x64、.NET Framework 4.8 与 WebView2 Runtime。\r\n这是开发目录，移动时保留整个目录；不包含安装程序。\r\n账号、设置、报告、房间方案、家具模块与照片库参数位于 %LOCALAPPDATA%\\XiaoyangWorkbox。\r\n",
);
execFileSync(
  csc,
  [
    ...common,
    "/target:exe",
    `/out:${join(output, "CaptureBridge.exe")}`,
    "/r:System.Drawing.dll",
    join(root, "desktop/CaptureBridge.cs"),
  ],
  { stdio: "inherit" },
);
const sharex = join(root, "vendor/ShareX-21.0.0");
if (existsSync(join(sharex, "ShareX.exe"))) {
  execFileSync(
    "dotnet",
    [
      "build",
      join(root, "desktop/sharex-host/ShareX.Workbox.csproj"),
      "-c",
      "Release",
      "--nologo",
      "--ignore-failed-sources",
    ],
    { stdio: "inherit" },
  );
  cpSync(sharex, join(output, "components/ShareX-21.0.0"), { recursive: true });
  const hostBin = join(root, "desktop/sharex-host/bin/Release/net9.0-windows");
  for (const file of ["ShareX.Workbox.exe", "ShareX.Workbox.dll"])
    copyFileSync(
      join(hostBin, file),
      join(output, "components/ShareX-21.0.0", file),
    );
  // Use the portable component's self-contained .NET runtime and dependency map.
  for (const suffix of ["runtimeconfig.json", "deps.json"])
    copyFileSync(
      join(sharex, "ShareX." + suffix),
      join(output, "components/ShareX-21.0.0/ShareX.Workbox." + suffix),
    );
  mkdirSync(join(output, "third-party"), { recursive: true });
  for (const file of ["ShareX-LICENSE.txt", "ShareX-21.0.0-source.zip"])
    copyFileSync(join(root, "vendor", file), join(output, "third-party", file));
  copyFileSync(
    join(root, "docs/THIRD-PARTY.md"),
    join(output, "third-party/NOTICE.md"),
  );
  cpSync(
    join(root, "desktop/sharex-host"),
    join(output, "third-party/sharex-workbox-source"),
    {
      recursive: true,
      filter: (path) =>
        !path.includes("/bin") &&
        !path.includes("\\bin") &&
        !path.includes("/obj") &&
        !path.includes("\\obj"),
    },
  );
} else
  console.warn(
    "ShareX not prepared. Run scripts/prepare-sharex.ps1 to enable screenshots.",
  );
execFileSync(process.execPath,[join(root,"scripts/build-computer-host.mjs")],{stdio:"inherit"});
copyOcrRuntime(root,output);
execFileSync(process.execPath,[join(root,'scripts/build-managed-hosts.mjs')],{stdio:'inherit'});
console.log("Desktop executables: " + output);
