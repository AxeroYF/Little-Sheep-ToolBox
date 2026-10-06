import { resolve } from "node:path";
import { createApp } from "../server/app";
// Separate, disposable account store. Browser launch checks never start the real app.
const app = await createApp({
  root: process.cwd(),
  databasePath: resolve(process.env.WORKBOX_TEST_DATABASE || `runtime/browser-test-${Date.now()}.sqlite`),
  host: "127.0.0.1",
  origin: "http://127.0.0.1:4329",
  platform: "win32",
  launcher: async () => {},
  networkExe: resolve('desktop-dev/小羊网络测试.exe'),
  roomExe: resolve('desktop-dev/小羊房间设计.exe'),
  probePath: resolve('desktop-dev/NetworkProbe.exe'),
  logger: false,
});
await app.listen({ host: "127.0.0.1", port: 4329 });
console.log(
  "Isolated browser test server: http://127.0.0.1:4329 (native launch simulated)",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
