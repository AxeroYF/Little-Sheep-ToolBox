import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../server/app";
import { ComputerSampler } from "../server/computer";
import {
  defaultComputerSettings,
  selectedNetwork,
  type ComputerSample,
} from "../shared/computer";

const origin = "http://127.0.0.1:4328",
  headers = { host: "127.0.0.1:4328", origin };
async function fixture(bundled = false) {
  const temp = mkdtempSync(join(tmpdir(), "computer-test-")),
    root = bundled ? join(temp, "app") : temp;
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(
    join(root, "config/apps.json"),
    JSON.stringify({ schemaVersion: 1, apps: [] }),
  );
  if (bundled) writeFileSync(join(root, "server.cjs"), "test");
  const exeRoot = bundled ? temp : join(root, "desktop-dev");
  mkdirSync(exeRoot, { recursive: true });
  let reads = 0,
    disposed = false;
  const launches: string[] = [];
  const sampler = {
    snapshot: () => {
      reads++;
      return {
        info: null,
        sample: null,
        history: [],
        status: "starting" as const,
        error: null,
      };
    },
    dispose: () => {
      disposed = true;
    },
  };
  const app = await createApp({
    root,
    databasePath: join(temp, "test.sqlite"),
    host: "127.0.0.1",
    origin,
    platform: "win32",
    nativeFilesToken: "test-native",
    computerSampler: sampler,
    launcher: async (entry) => {
      launches.push(entry.path);
    },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers,
    payload: { username: "小羊", password: "Workbox-Local-Dev-2026!" },
  });
  assert.equal(login.statusCode, 200);
  const auth = {
    ...headers,
    cookie: String(login.headers["set-cookie"]).split(";")[0],
  };
  return {
    app,
    root,
    exeRoot,
    auth,
    launches,
    reads: () => reads,
    disposed: () => disposed,
    cleanup: async () => {
      await app.close();
      assert.ok(resolve(temp).startsWith(resolve(tmpdir(), "computer-test-")));
      rmSync(temp, { recursive: true, force: true });
    },
  };
}
test("computer metrics require login; overlay settings require native capability and persist normalized keys", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.app.inject({ url: "/api/computer/snapshot", headers }))
        .statusCode,
      401,
    );
    assert.equal(f.reads(), 0);
    assert.equal(
      (await f.app.inject({ url: "/api/computer/snapshot", headers: f.auth }))
        .statusCode,
      200,
    );
    assert.equal(f.reads(), 1);
    const get = () =>
      f.app.inject({ url: "/api/computer/settings", headers: f.auth });
    assert.deepEqual((await get()).json(), defaultComputerSettings());
    const next = {
      hotkey: "Alt+Ctrl+M",
      mode: "mini",
      opacity: 0.65,
      anchor: "bottom-left",
      closeToTray: false,
    };
    assert.equal(
      (
        await f.app.inject({
          method: "PUT",
          url: "/api/computer/settings",
          headers: f.auth,
          payload: next,
        })
      ).statusCode,
      403,
    );
    const native = { ...f.auth, "x-workbox-native-files": "test-native" };
    for (const invalid of [
      { ...next, hotkey: "R" },
      { ...next, opacity: 0 },
      { ...next, mode: "fullscreen" },
      { ...next, command: "bad" },
    ])
      assert.equal(
        (
          await f.app.inject({
            method: "PUT",
            url: "/api/computer/settings",
            headers: native,
            payload: invalid,
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await f.app.inject({
          method: "PUT",
          url: "/api/computer/settings",
          headers: native,
          payload: next,
        })
      ).statusCode,
      200,
    );
    assert.deepEqual((await get()).json(), { ...next, hotkey: "Ctrl+Alt+M" });
    await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: f.auth,
    });
    assert.equal(
      (await f.app.inject({ url: "/api/computer/snapshot", headers: f.auth }))
        .statusCode,
      401,
    );
    assert.equal(f.reads(), 1);
  } finally {
    await f.cleanup();
    assert.equal(f.disposed(), true);
  }
});
for (const bundled of [false, true])
  test(`catalog discovers image/computer exe without host environment, including installation after startup (${bundled ? "bundled" : "dev"})`, async () => {
    const f = await fixture(bundled);
    try {
      const apps = async () =>
        (await f.app.inject({ url: "/api/apps", headers: f.auth })).json().apps;
      assert.ok(!(await apps()).some((a: any) => a.id === "xiaoyang-images"));
      for (const name of ["小羊图片工坊", "小羊电脑信息"])
        writeFileSync(join(f.exeRoot, name + ".exe"), "test-only");
      for (const [id, name] of [
        ["xiaoyang-images", "小羊图片工坊"],
        ["xiaoyang-computer", "小羊电脑信息"],
      ]) {
        const item = (await apps()).find((a: any) => a.id === id);
        assert.equal(item.name, name);
        assert.equal(item.installed, true);
        assert.equal(
          (
            await f.app.inject({
              method: "POST",
              url: `/api/apps/${id}/launch`,
              headers: f.auth,
            })
          ).statusCode,
          200,
        );
        assert.equal(f.launches.at(-1), join(f.exeRoot, name + ".exe"));
      }
    } finally {
      await f.cleanup();
    }
  });
test("physical adapter auto-selection avoids counting VPN traffic twice and missing manual adapter stays missing", () => {
  const sample = {
    networks: [
      { id: "vpn", name: "VPN", virtual: true, receive: 5000, send: 1000 },
      {
        id: "ethernet",
        name: "Ethernet",
        virtual: false,
        receive: 2000,
        send: 1000,
      },
    ],
  } as ComputerSample;
  assert.equal(selectedNetwork(sample, "auto")?.id, "ethernet");
  assert.equal(selectedNetwork(sample, "vpn")?.id, "vpn");
  assert.equal(selectedNetwork(sample, "unplugged"), undefined);
  assert.equal(selectedNetwork(null, "auto"), undefined);
});
test("missing probe reports unavailable rather than simulated zero metrics", () => {
  const sampler = new ComputerSampler(resolve("runtime/missing-probe.exe"));
  try {
    const result = sampler.snapshot();
    assert.equal(result.status, "unavailable");
    assert.equal(result.sample, null);
    assert.deepEqual(result.history, []);
  } finally {
    sampler.dispose();
  }
});
test('power estimation preferences persist per account and reject invalid efficiency',async()=>{
  const f=await fixture();try{
    const original=(await f.app.inject({url:'/api/computer/power-settings',headers:f.auth})).json();
    assert.equal(original.efficiency,.9);
    assert.equal((await f.app.inject({method:'PUT',url:'/api/computer/power-settings',headers:f.auth,payload:{...original,efficiency:0}})).statusCode,400);
    assert.equal((await f.app.inject({method:'PUT',url:'/api/computer/power-settings',headers:f.auth,payload:{...original,other:60}})).statusCode,200);
    assert.equal((await f.app.inject({url:'/api/computer/power-settings',headers:f.auth})).json().other,60);
  }finally{await f.cleanup();}
});
