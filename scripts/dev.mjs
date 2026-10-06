import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  stdio: "inherit",
  env: { ...process.env, WORKBOX_DEV_ORIGIN: "http://127.0.0.1:5188" },
});
const web = spawn(
  process.execPath,
  [
    join(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--configLoader",
    "runner",
  ],
  { stdio: "inherit" },
);
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  server.kill();
  web.kill();
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
server.on("exit", code => stop(code ?? 1));
web.on("exit", code => stop(code ?? 1));
for (const child of [server, web]) child.on("error", error => { console.error(error.message); stop(1); });
