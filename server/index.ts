import { config } from "dotenv";
import { resolve } from "node:path";
import { createApp } from "./app";
import { initialAccount } from "./default-account";
config({ path: resolve(".env"), quiet: true });
const port = Number(process.env.WORKBOX_PORT || 4328);
const host = process.env.WORKBOX_HOST || "127.0.0.1";
async function main() {
  const app = await createApp({
    root: process.cwd(),
    initialAccount: initialAccount(process.cwd(),process.env.WORKBOX_INITIAL_PASSWORD),
    host,
    databasePath: resolve(
      process.env.WORKBOX_DATABASE || "runtime/workbox.sqlite",
    ),
    origin: process.env.WORKBOX_ORIGIN || `http://127.0.0.1:${port}`,
    devOrigin: process.env.WORKBOX_DEV_ORIGIN,
    logger: !process.env.WORKBOX_DESKTOP_TOKEN,
    desktopToken: process.env.WORKBOX_DESKTOP_TOKEN,
    networkExe: process.env.WORKBOX_NETWORK_EXE,
    roomExe: process.env.WORKBOX_ROOM_EXE,
    imageExe: process.env.WORKBOX_IMAGE_EXE || (process.env.WORKBOX_DESKTOP_TOKEN ? resolve("../小羊图片工坊.exe") : undefined),
    computerExe:process.env.WORKBOX_COMPUTER_EXE,
    computerProbe:process.env.WORKBOX_COMPUTER_PROBE,
    nativeFilesToken: process.env.WORKBOX_NATIVE_FILES_TOKEN,
    rawExe: process.env.WORKBOX_RAW_EXE || (process.env.WORKBOX_DESKTOP_TOKEN ? resolve("../components/LibRaw-0.22.2/RawPhoto.exe") : undefined),
    probePath: process.env.WORKBOX_PROBE_EXE,
    dataDir: process.env.WORKBOX_DATA_DIR,
    sharexSource: process.env.WORKBOX_SHAREX_SOURCE,
    captureBridge: process.env.WORKBOX_CAPTURE_BRIDGE,
  });
  if (process.env.WORKBOX_DESKTOP_TOKEN)
    app.post("/api/desktop/shutdown", async () => {
      setTimeout(() => {
        void app.close().finally(() => process.exit(0));
      }, 30).unref();
      return { ok: true };
    });
  await app.listen({ host, port });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  const parentPid = Number(process.env.WORKBOX_PARENT_PID);
  if (parentPid > 0)
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        void app.close().finally(() => process.exit(0));
      }
    }, 2000).unref();
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
