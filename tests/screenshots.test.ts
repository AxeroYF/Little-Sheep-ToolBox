import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { createApp } from "../server/app";
import { sharexSettings } from "../server/screenshots";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);
const origin = "http://127.0.0.1:4433";
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "workbox-capture-test-"));
  mkdirSync(join(root, "config"));
  mkdirSync(join(root, "source"));
  writeFileSync(
    join(root, "config/apps.json"),
    JSON.stringify({ schemaVersion: 1, apps: [] }),
  );
  writeFileSync(join(root, "source/ShareX.exe"), "fixture");
  writeFileSync(join(root, "bridge.exe"), "fixture");
  let behavior = "receipt";
  const databasePath = join(root, "data.sqlite");
  const options = {
    root,
    databasePath,
    origin,
    platform: "win32",
    dataDir: root,
    nativeFilesToken: "video-test-capability",
    sharexSource: join(root, "source"),
    captureBridge: join(root, "bridge.exe"),
    screenshotAdapter: {
      thumbnail: async (_source: string, target: string) => {
        writeFileSync(target, "thumbnail");
        return { width: 1, height: 1 };
      },
      launch: (_exe: string, args: string[], cwd: string) => {
        assert.ok(args.includes("-multi"));
        assert.ok(args.includes("-portable"));
        const settings = JSON.parse(
          readFileSync(join(cwd, "ShareX/ApplicationConfig.json"), "utf8"),
        );
        assert.equal(settings.DisableUpload, true);
        assert.equal(
          settings.DefaultTaskSettings.AfterCaptureJob & (1 << 20),
          0,
        );
        assert.deepEqual(
          JSON.parse(
            readFileSync(join(cwd, "ShareX/HotkeysConfig.json"), "utf8"),
          ),
          { Hotkeys: [] },
        );
        const directory = settings.CustomScreenshotsPath;
        const code = `const fs=require('fs'),path=require('path');const [dir,mode,image]=process.argv.slice(1);setTimeout(()=>{if(mode==='hold')return;if(mode!=='cancel'){const file=mode==='outside'?path.resolve(dir,'../../../outside.png'):path.join(dir,'capture.png');fs.writeFileSync(file,Buffer.from(image,'base64'));if(mode!=='fallback')fs.writeFileSync(path.resolve(dir,'../receipt.json'),JSON.stringify({path:file}));}process.exit(0)},200);setInterval(()=>{},1000);`;
        return spawn(
          process.execPath,
          ["-e", code, directory, behavior, png.toString("base64")],
          { stdio: "ignore", windowsHide: true },
        );
      },
    },
  };
  const app = await createApp(options);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { host: "127.0.0.1:4433", origin },
    payload: { username: "小羊", password: "Workbox-Local-Dev-2026!" },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const headers = { host: "127.0.0.1:4433", origin, cookie };
  const request = (
    method: "GET" | "POST" | "PATCH",
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: "/api" + path,
      headers,
      payload: payload as Record<string, unknown> | undefined,
    });
  const wait = async () => {
    for (let i = 0; i < 70; i++) {
      const r = (await request("GET", "/screenshots/status")).json();
      if (r.job && !["starting", "running"].includes(r.job.status))
        return r.job;
      await new Promise((r) => setTimeout(r, 75));
    }
    throw new Error("capture timeout");
  };
  return {
    app,
    root,
    databasePath,
    options,
    headers,
    request,
    wait,
    behavior: (mode: string) => (behavior = mode),
    cleanup: async () => {
      await app.close();
      await new Promise((r) => setTimeout(r, 150));
      if (!resolve(root).startsWith(resolve(tmpdir(), "workbox-capture-test-")))
        throw new Error("cleanup path");
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("native video frame import requires login and capability, validates PNG and joins gallery", async()=>{
  const f=await fixture();
  try{
    const sharp=(await import('sharp')).default;
    const frame=await sharp({create:{width:16,height:9,channels:3,background:'#1483ff'}}).png().toBuffer();
    const headers={...f.headers,"content-type":"application/octet-stream","x-workbox-native-files":"video-test-capability"};
    const send=(body:Buffer,extra=headers)=>f.app.inject({method:'POST',url:'/api/screenshots/video-frame?name=Frame',headers:extra,payload:body});
    assert.equal((await send(png,{...headers,cookie:''})).statusCode,401);
    assert.equal((await send(png,{...headers,'x-workbox-native-files':'invalid'})).statusCode,403);
    assert.equal((await send(Buffer.from('not an image'))).statusCode,400);
    assert.equal((await send(png.subarray(0,12))).statusCode,400);
    const imported=await send(frame);assert.equal(imported.statusCode,200,imported.body);
    const image=imported.json().image;assert.equal(image.category,'视频截帧');assert.equal(image.width,16);
    const gallery=(await f.request('GET','/screenshots')).json();assert.equal(gallery.images.length,1);assert.equal(gallery.images[0].id,image.id);
    const original=await f.request('GET',`/screenshots/${image.id}/image`);assert.equal(original.statusCode,200);assert.deepEqual(original.rawPayload,frame);
  }finally{await f.cleanup();}
});
test("ShareX callback imports once, protected files, gallery management and original-preserving edit", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.app.inject({
          url: "/api/screenshots",
          headers: { host: "127.0.0.1:4433" },
        })
      ).statusCode,
      401,
    );
    const started = await f.request("POST", "/screenshots/capture", {
      mode: "region",
    });
    assert.equal(started.statusCode, 200);
    assert.equal(
      (await f.request("POST", "/screenshots/capture", { mode: "screen" }))
        .statusCode,
      409,
    );
    const job = await f.wait();
    assert.equal(job.status, "complete");
    const list = (await f.request("GET", "/screenshots")).json();
    assert.equal(list.total, 1);
    const id = list.images[0].id;
    assert.deepEqual(
      (await f.request("GET", `/screenshots/${id}/image`)).rawPayload,
      png,
    );
    await f.request("PATCH", "/screenshots", {
      ids: [id],
      favorite: true,
      category: "测试",
      title: "测试截图",
    });
    assert.equal(
      (
        await f.request(
          "GET",
          "/screenshots?view=favorites&category=测试&query=测试",
        )
      ).json().total,
      1,
    );
    assert.equal(
      (
        await f.request("PATCH", "/screenshots", {
          ids: [id, randomUUID()],
          title: "不得部分修改",
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await f.request("GET", "/screenshots")).json().images[0].title,
      "测试截图",
    );
    await f.request("PATCH", "/screenshots", { ids: [id], trash: true });
    assert.equal((await f.request("GET", "/screenshots")).json().total, 0);
    assert.equal(
      (await f.request("GET", "/screenshots?view=trash")).json().total,
      1,
    );
    assert.equal(
      (
        await f.request("POST", "/screenshots/capture", {
          mode: "edit",
          parentId: id,
        })
      ).statusCode,
      404,
    );
    await f.request("PATCH", "/screenshots", { ids: [id], trash: false });
    assert.equal(
      (
        await f.request("POST", "/screenshots/capture", {
          mode: "edit",
          parentId: id,
        })
      ).statusCode,
      200,
    );
    assert.equal((await f.wait()).status, "complete");
    const edited = (await f.request("GET", "/screenshots")).json();
    assert.equal(edited.total, 2);
    assert.equal(edited.images[0].parentId, id);
    assert.equal(edited.images[0].category, "测试");
    const native = (await f.request("GET", `/screenshots/${id}/native`)).json();
    assert.equal(
      native.path,
      join(f.root, "screenshots/originals", id, "测试截图.png"),
    );
    assert.deepEqual(readFileSync(native.path), png);
    await new Promise((r) => setTimeout(r, 950));
    assert.equal((await f.request("GET", "/screenshots")).json().total, 2);
    // Foreign account cannot view, mutate or edit another owner's image.
    const db = new Database(f.databasePath);
    const second = randomUUID();
    db.prepare(
      "INSERT INTO users SELECT ?, 'second', 'second', salt, passwordHash, createdAt FROM users LIMIT 1",
    ).run(second);
    db.close();
    const login = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: f.headers,
      payload: { username: "second", password: "Workbox-Local-Dev-2026!" },
    });
    const h = {
      ...f.headers,
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    assert.equal(
      (await f.app.inject({ url: `/api/screenshots/${id}/image`, headers: h }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: "/api/screenshots",
          headers: h,
          payload: { ids: [id], trash: true },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/screenshots", headers: h })).json()
        .total,
      0,
    );
  } finally {
    await f.cleanup();
  }
});
test("ShareX cancellation creates no history, fallback recovers missing callback, outside receipt rejected", async () => {
  const f = await fixture();
  try {
    f.behavior("cancel");
    await f.request("POST", "/screenshots/capture", { mode: "region" });
    assert.equal((await f.wait()).status, "cancelled");
    assert.equal((await f.request("GET", "/screenshots")).json().total, 0);
    f.behavior("fallback");
    await f.request("POST", "/screenshots/capture", { mode: "screen" });
    assert.equal((await f.wait()).status, "complete");
    assert.equal((await f.request("GET", "/screenshots")).json().total, 1);
    f.behavior("outside");
    await f.request("POST", "/screenshots/capture", { mode: "window" });
    const failed = await f.wait();
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /任务目录/);
    assert.equal((await f.request("GET", "/screenshots")).json().total, 1);
    f.behavior("hold");
    await f.request("POST", "/screenshots/capture", { mode: "region" });
    await f.request("POST", "/screenshots/cancel", {});
    assert.equal((await f.wait()).status, "cancelled");
    assert.equal(
      (
        await f.request("POST", "/screenshots/capture", {
          mode: "arbitrary.exe",
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.cleanup();
  }
});
test("close-to-tray persists and cross-service logout stops an owned capture", async () => {
  const f = await fixture();
  let other;
  try {
    await f.request("PATCH", "/preferences", { closeToTray: true });
    assert.equal(
      (await f.request("GET", "/preferences")).json().closeToTray,
      true,
    );
    other = await createApp(f.options);
    await other.ready();
    assert.equal(
      (
        await other.inject({ url: "/api/preferences", headers: f.headers })
      ).json().closeToTray,
      true,
    );
    f.behavior("hold");
    await f.request("POST", "/screenshots/capture", { mode: "region" });
    await other.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: f.headers,
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 1200));
    const db = new Database(f.databasePath);
    assert.equal(
      (
        db
          .prepare(
            "SELECT status FROM capture_jobs ORDER BY createdAt DESC LIMIT 1",
          )
          .get() as { status: string }
      ).status,
      "cancelled",
    );
    db.close();
  } finally {
    await other?.close();
    await f.cleanup();
  }
});
test("isolated ShareX settings disable uploads, updates and personal hotkey reuse", () => {
  const settings = sharexSettings(
    "D:\\test\\output",
    "D:\\test\\receipt.json",
    "D:\\test\\bridge.exe",
  );
  assert.equal(settings.DisableUpload, true);
  assert.equal(settings.AutoCheckUpdate, false);
  assert.equal(settings.DefaultTaskSettings.AfterUploadJob, 0);
  assert.equal(settings.DefaultTaskSettings.AfterCaptureJob, 2336);
  assert.match(
    settings.DefaultTaskSettings.ExternalPrograms[0].Args,
    /\"\$input\"/,
  );
});
test("ShareX app entry opens managed gallery, is favoriteable and records recent use", async () => {
  const f = await fixture();
  try {
    const tools = (await f.request("GET", "/apps")).json().apps;
    assert.equal(
      tools.find((t: { id: string }) => t.id === "sharex").launchable,
      true,
    );
    const opened = await f.request("POST", "/apps/sharex/launch", {});
    assert.equal(opened.json().page, "screenshots");
    await f.request("PATCH", "/preferences", { favorites: ["sharex"] });
    const prefs = (await f.request("GET", "/preferences")).json();
    assert.deepEqual(prefs.favorites, ["sharex"]);
    assert.equal(prefs.recent[0].id, "sharex");
    assert.equal((await f.request("GET", "/screenshots")).json().total, 0);
  } finally {
    await f.cleanup();
  }
});
test("custom capture preferences persist, invalid shortcuts rejected, safe filenames preserve image data", async () => {
  const f = await fixture();
  let second;
  try {
    assert.equal(
      (await f.request("GET", "/preferences")).json().captureHotkey,
      "Ctrl+Alt+S",
    );
    const saved = await f.request("PATCH", "/preferences", {
      captureHotkey: "Shift+Ctrl+K",
      minimizeOnCapture: false,
    });
    assert.equal(saved.json().captureHotkey, "Ctrl+Shift+K");
    assert.equal(
      (await f.request("PATCH", "/preferences", { captureHotkey: "Alt+F4" }))
        .statusCode,
      400,
    );
    second = await createApp(f.options);
    const preferences = (
      await second.inject({ url: "/api/preferences", headers: f.headers })
    ).json();
    assert.equal(preferences.captureHotkey, "Ctrl+Shift+K");
    assert.equal(preferences.minimizeOnCapture, false);
    await second.close();
    second = undefined;
    await f.request("POST", "/screenshots/capture", { mode: "region" });
    const job = await f.wait();
    assert.equal(
      (
        await f.request("PATCH", "/screenshots", {
          ids: [job.imageId],
          title: "CON",
        })
      ).statusCode,
      200,
    );
    const renamed = (
      await f.request("GET", `/screenshots/${job.imageId}/native`)
    ).json().path;
    assert.equal(basename(renamed), "_CON.png");
    await f.request("PATCH", "/screenshots", {
      ids: [job.imageId],
      title: "../截图:报告.png",
    });
    const path = (
      await f.request("GET", `/screenshots/${job.imageId}/native`)
    ).json().path;
    assert.equal(
      resolve(path).startsWith(
        resolve(f.root, "screenshots/originals", job.imageId),
      ),
      true,
    );
    assert.deepEqual(
      (await f.request("GET", `/screenshots/${job.imageId}/image`)).rawPayload,
      png,
    );
    assert.equal(existsSync(renamed), false);
  } finally {
    await second?.close();
    await f.cleanup();
  }
});
