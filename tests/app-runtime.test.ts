import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import {
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  existsSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { AppRuntimeController } from "../server/app-runtime";
import { createApp } from "../server/app";
const wait = async (fn: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw Error("Test process did not reach expected state");
};
test(
  "real Windows background detection, same-name path isolation, graceful cancellation and exit",
  { timeout: 25000 },
  async () => {
    const dir = mkdtempSync(resolve("runtime/lifecycle-"));
    mkdirSync(join(dir, "one"));
    mkdirSync(join(dir, "two"));
    const exe = join(dir, "one", "AppFixture.exe"),
      twin = join(dir, "two", "AppFixture.exe"),
      helper = join(dir, "AppControl.exe");
    const csc = join(
      process.env.WINDIR!,
      "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
    );
    execFileSync(csc, [
      "/nologo",
      "/target:winexe",
      "/out:" + exe,
      "/r:System.dll",
      "/r:System.Windows.Forms.dll",
      resolve("tests/AppFixture.cs"),
    ]);
    copyFileSync(exe, twin);
    execFileSync(csc, [
      "/nologo",
      "/target:exe",
      "/out:" + helper,
      "/r:System.dll",
      "/r:System.Core.dll",
      "/r:System.Web.Extensions.dll",
      resolve("desktop/AppControl.cs"),
    ]);
    const first = spawn(exe, [join(dir, "first")], {
        windowsHide: true,
        stdio: "ignore",
      }),
      second = spawn(twin, [join(dir, "second")], {
        windowsHide: true,
        stdio: "ignore",
      });
    first.on("error", () => {});
    second.on("error", () => {});
    const control = new AppRuntimeController(helper),
      entry = { id: "fixture", path: exe, managed: true };
    try {
      await wait(
        () => existsSync(join(dir, "first")) && existsSync(join(dir, "second")),
      );
      let status = (await control.list([entry], true)).fixture;
      assert.equal(status.state, "running");
      assert.equal(status.instances, 1);
      assert.equal(status.canClose, true);
      writeFileSync(join(dir, "first.cancel"), "keep unsaved work");
      assert.equal(await control.action(entry, "close"), true);
      await wait(
        () => readFileSync(join(dir, "first"), "utf8") === "cancelled",
      );
      assert.equal(
        (await control.list([entry], true)).fixture.state,
        "closing",
      );
      assert.equal(first.exitCode, null);
      assert.equal(second.exitCode, null);
      assert.equal(await control.action(entry, "close"), true);
      await wait(() => first.exitCode !== null);
      assert.equal(
        (await control.list([entry], true)).fixture.state,
        "stopped",
      );
      assert.equal(second.exitCode, null);
      assert.equal(
        await control.action(
          { ...entry, path: join(dir, "wrong.exe") },
          "close",
        ),
        false,
      );
    } finally {
      control.dispose();
      if (first.exitCode === null) first.kill();
      if (second.exitCode === null) second.kill();
      await wait(
        () =>
          (first.exitCode !== null || first.signalCode !== null) &&
          (second.exitCode !== null || second.signalCode !== null),
      );
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("window detection ignores hidden launchers and workers, retains minimized windows and permits relaunch", { timeout: 25000 }, async () => {
  const dir = mkdtempSync(resolve("runtime/lifecycle-window-"));
  mkdirSync(join(dir, "other"));
  const exe = join(dir, "WindowFixture.exe"), twin = join(dir, "other/WindowFixture.exe"), helper = join(dir, "AppControl.exe");
  const csc = join(process.env.WINDIR!, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  execFileSync(csc, ["/nologo", "/target:winexe", "/out:" + exe, "/r:System.dll", "/r:System.Drawing.dll", "/r:System.Windows.Forms.dll", resolve("tests/WindowAppFixture.cs")]);
  execFileSync(csc, ["/nologo", "/target:exe", "/out:" + helper, "/r:System.dll", "/r:System.Core.dll", "/r:System.Web.Extensions.dll", resolve("desktop/AppControl.cs")]);
  copyFileSync(exe, twin);
  const files = [join(dir, "launcher"), join(dir, "worker"), join(dir, "unrelated")];
  const children = files.map((file, i) => spawn(i === 2 ? twin : exe, [file], { windowsHide: true, stdio: "ignore" }));
  const control = new AppRuntimeController(helper);
  const entry = { id: "fixture", path: exe, managed: false, detection: "window" as const };
  const command = async (index: number, value: string) => {
    writeFileSync(files[index] + ".command", value);
    await wait(() => readFileSync(files[index], "utf8") === value);
  };
  try {
    await wait(() => files.every(existsSync));
    await command(2, "show"); // Same name elsewhere must never qualify.
    assert.equal((await control.list([entry], true)).fixture.state, "stopped");
    assert.equal((await control.list([{ ...entry, detection: "process" }], true)).fixture.instances, 2);
    assert.equal(await control.action(entry, "close"), false);
    await command(0, "show");
    let status = (await control.list([entry], true)).fixture;
    assert.equal(status.state, "running");
    assert.equal(status.instances, 1); // Ignore the other helper with the identical exe path.
    assert.equal(status.canClose, true);
    await command(0, "minimize");
    assert.equal((await control.list([entry], true)).fixture.state, "running");
    assert.equal(await control.action(entry, "close"), true);
    await wait(() => readFileSync(files[0], "utf8") === "closed");
    assert.equal((await control.list([entry], true)).fixture.state, "stopped");
    assert.ok(children.every(child => child.exitCode === null)); // Launcher and workers still live.
    await command(0, "show");
    assert.equal((await control.list([entry], true)).fixture.state, "running");
    await command(0, "hide");
    assert.equal((await control.list([entry], true)).fixture.state, "stopped");
  } finally {
    control.dispose();
    for (let i=0;i<children.length;i++) if(children[i].exitCode === null) writeFileSync(files[i]+".command", "exit");
    try { await wait(() => children.every(child => child.exitCode !== null)); }
    finally {
      for (const child of children) if(child.exitCode === null)child.kill();
      await wait(() => children.every(child => child.exitCode !== null || child.signalCode !== null));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("catalog control uses fixed registered entries, exposes runtime, and requires login", async () => {
  const dir = mkdtempSync(resolve("runtime/lifecycle-api-"));
  mkdirSync(join(dir, "config"));
  const exe = join(dir, "fixture.exe");
  writeFileSync(exe, "test");
  writeFileSync(
    join(dir, "config/apps.json"),
    JSON.stringify({
      schemaVersion: 1,
      apps: [
        {
          id: "fixture",
          name: "fixture",
          description: "",
          category: "test",
          platform: "windows",
          version: null,
          integration: "external",
          lifecycle: { detection: "window" },
          entry: { type: "executable", path: exe, args: [] },
        },
      ],
    }),
  );
  const actions: unknown[] = [],
    origin = "http://127.0.0.1:4348",
    headers = { host: "127.0.0.1:4348", origin };
  let launches = 0;
  const app = await createApp({
    root: dir,
    origin,
    databasePath: join(dir, "test.sqlite"),
    platform: "win32",
    appController: {
      list: async () => ({
        fixture: {
          state: "running",
          instances: 1,
          since: 1,
          canClose: true,
          canShow: true,
        },
      }),
      action: async (entry, action) => {
        actions.push({ entry, action });
        return true;
      },
      starting: () => {},
      dispose: () => {},
    },
    launcher: async () => {
      launches++;
    },
  });
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/apps/fixture/close",
          headers,
          payload: {},
        })
      ).statusCode,
      401,
    );
    const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers,
        payload: { username: "小羊", password: "Workbox-Local-Dev-2026!" },
      }),
      auth = {
        ...headers,
        cookie: String(login.headers["set-cookie"]).split(";")[0],
      };
    assert.equal(
      (await app.inject({ url: "/api/apps", headers: auth })).json().apps[0]
        .runtime.state,
      "running",
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/apps/fixture/launch",
          headers: auth,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(launches, 0);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/apps/fixture/close",
          headers: auth,
          payload: { path: "C:/unrelated.exe", pid: 1 },
        })
      ).statusCode,
      200,
    );
    assert.deepEqual(actions[1], {
      entry: { id: "fixture", path: exe, managed: false, detection: "window" },
      action: "close",
    });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/apps/unknown/close",
          headers: auth,
          payload: {},
        })
      ).statusCode,
      404,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
