import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { createApp } from "../server/app";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";

const origin = "http://127.0.0.1:4328";
const headers = { host: "127.0.0.1:4328", origin };
const password = "A-local-test-passphrase-42";
async function fixture(
  opts: {
    missing?: boolean;
    fails?: boolean;
    remote?: boolean;
    desktopToken?: string;
    chess?: boolean;
  } = {},
) {
  const prefix = join(tmpdir(), "xiaoyang-test-");
  const root = mkdtempSync(prefix);
  mkdirSync(join(root, "config"));
  const exe = join(root, "Demo.exe");
  if (!opts.missing) writeFileSync(exe, "test-only");
  writeFileSync(
    join(root, "config/apps.json"),
    JSON.stringify({
      schemaVersion: 1,
      apps: [
        {
          id: opts.chess ? "xiaoyang-chess" : "yellow-dogs",
          name: "黄狗风云",
          description: "test",
          category: "游戏娱乐",
          platform: "windows",
          version: null,
          integration: "external",
          entry: { type: "executable", path: exe, args: [] },
        },
      ],
    }),
  );
  let launches = 0;
  let launchArgs: string[] = [];
  const databasePath = join(root, "accounts.sqlite");
  const options = {
    root,
    databasePath,
    origin: opts.remote ? "https://workbox.example" : origin,
    host: opts.remote ? "0.0.0.0" : "127.0.0.1",
    platform: "win32",
    desktopToken: opts.desktopToken,
    launcher: async (entry: { path: string; args: string[] }) => {
      assert.equal(entry.path, exe);
      if (opts.fails) throw new Error("expected test failure");
      launches++;
      launchArgs = entry.args;
    },
  };
  const app = await createApp(options);
  const requestHeaders = opts.remote
    ? { host: "workbox.example", origin: "https://workbox.example" }
    : headers;
  const provision = (username = "tester_01") => {
    const db = new Database(databasePath);
    const normalized = username.toLowerCase();
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }).toString("hex");
    db.prepare("INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)").run(
      randomUUID(),
      normalized,
      "测试用户",
      salt,
      hash,
      Date.now(),
    );
    db.close();
    return app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: requestHeaders,
      payload: { username, password },
    });
  };
  return {
    app,
    root,
    databasePath,
    options,
    provision,
    requestHeaders,
    launches: () => launches,
    launchArgs: () => launchArgs,
    cleanup: async () => {
      await app.close();
      if (!resolve(root).startsWith(resolve(prefix)))
        throw new Error("Invalid test cleanup path");
      rmSync(root, { recursive: true, force: true });
    },
  };
}
function session(r: { headers: Record<string, unknown> }) {
  return String(r.headers["set-cookie"]).split(";")[0];
}

test("provisioned account login, hashed passwords, session cookies and persistent login", async () => {
  const f = await fixture();
  try {
    const r = await f.provision();
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().user.username, "tester_01");
    assert.ok(!JSON.stringify(r.json()).includes("password"));
    assert.match(String(r.headers["set-cookie"]), /HttpOnly/);
    assert.match(String(r.headers["set-cookie"]), /SameSite=Strict/i);
    const cookie = session(r);
    const me = await f.app.inject({
      url: "/api/session",
      headers: { ...headers, cookie },
    });
    assert.equal(me.json().user.displayName, "测试用户");
    const db = new Database(f.databasePath);
    const row = db
      .prepare("SELECT * FROM users WHERE username='tester_01'")
      .get() as {
      passwordHash: string;
      salt: string;
    };
    assert.notEqual(row.passwordHash, password);
    assert.equal(row.passwordHash.length, 128);
    assert.equal(row.salt.length, 32);
    db.close();
    await f.app.close();
    const reopened = await createApp(f.options);
    try {
      assert.equal(
        (
          await reopened.inject({
            url: "/api/session",
            headers: { ...headers, cookie },
          })
        ).json().user.username,
        "tester_01",
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});
test("login failure, successful login and logout revocation", async () => {
  const f = await fixture();
  try {
    await f.provision();
    const failed = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { username: "tester_01", password: "incorrect-passphrase" },
    });
    assert.equal(failed.statusCode, 401);
    const r = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { username: "tester_01", password },
    });
    assert.equal(r.statusCode, 200);
    const cookie = session(r);
    await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { ...headers, cookie },
      payload: {},
    });
    assert.equal(
      (
        await f.app.inject({
          url: "/api/preferences",
          headers: { ...headers, cookie },
        })
      ).statusCode,
      401,
    );
  } finally {
    await f.cleanup();
  }
});
test("registration always disabled, empty passwords rejected and login rate limited", async () => {
  const f = await fixture();
  try {
    const weak = await f.app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: { username: "newuser", displayName: "新用户", password: "123" },
    });
    assert.equal(weak.statusCode, 403);
    assert.equal(
      (await f.app.inject({ url: "/api/capabilities", headers })).json()
        .registration,
      false,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers,
          payload: { username: "小羊", password: "" },
        })
      ).statusCode,
      400,
    );
    for (let i = 0; i < 10; i++)
      await f.app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers,
        payload: { username: "nobody", password },
      });
    assert.equal((await f.provision()).statusCode, 429);
  } finally {
    await f.cleanup();
  }
});
test("reject cross-origin, missing Origin, and DNS rebinding host", async () => {
  const f = await fixture();
  try {
    for (const h of [
      { ...headers, origin: "https://attacker.example" },
      { host: headers.host },
      { ...headers, host: "attacker.example" },
    ]) {
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/auth/register",
            headers: h,
            payload: {},
          })
        ).statusCode,
        403,
      );
    }
    assert.equal(
      (
        await f.app.inject({
          url: "/api/session",
          headers: { host: "attacker.example" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.cleanup();
  }
});
test("account favorites isolated, unknown ids ignored, theme persisted", async () => {
  const f = await fixture();
  try {
    const first = session(await f.provision("first_user")),
      second = session(await f.provision("second_user"));
    const p = await f.app.inject({
      method: "PATCH",
      url: "/api/preferences",
      headers: { ...headers, cookie: first },
      payload: { favorites: ["yellow-dogs", "unknown"], theme: "dark" },
    });
    assert.deepEqual(p.json().favorites, ["yellow-dogs"]);
    assert.equal(p.json().theme, "dark");
    const q = await f.app.inject({
      url: "/api/preferences",
      headers: { ...headers, cookie: second },
    });
    assert.deepEqual(q.json().favorites, []);
    assert.equal(q.json().theme, "system");
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: "/api/preferences",
          headers: { ...headers, cookie: first },
          payload: { recent: [] },
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.cleanup();
  }
});
test("chess launch inherits account theme, ignores supplied arguments and records recent use", async () => {
  const f = await fixture({ chess: true });
  try {
    const cookie = session(await f.provision());
    const h = { ...headers, cookie };
    await f.app.inject({ method: "PATCH", url: "/api/preferences", headers: h,
      payload: { theme: "dark", favorites: ["xiaoyang-chess"] } });
    const launched = await f.app.inject({ method: "POST", url: "/api/apps/xiaoyang-chess/launch", headers: h,
      payload: { args: ["--theme=light"], path: "C:/unregistered.exe" } });
    assert.equal(launched.statusCode, 200);
    assert.deepEqual(f.launchArgs(), ["--theme=dark"]);
    const prefs = (await f.app.inject({ url: "/api/preferences", headers: h })).json();
    assert.deepEqual(prefs.favorites, ["xiaoyang-chess"]);
    assert.equal(prefs.recent[0].id, "xiaoyang-chess");
  } finally { await f.cleanup(); }
});
test("launch requires login, only uses allowlisted executable, records history and suppresses rapid repeats", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/apps/yellow-dogs/launch",
          headers,
          payload: {},
        })
      ).statusCode,
      401,
    );
    const cookie = session(await f.provision());
    const h = { ...headers, cookie };
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/apps/unknown/launch",
          headers: h,
          payload: {},
        })
      ).statusCode,
      404,
    );
    const r = await f.app.inject({
      method: "POST",
      url: "/api/apps/yellow-dogs/launch",
      headers: h,
      payload: { path: "C:\\untrusted.exe", args: ["injection"] },
    });
    assert.equal(r.json().status, "requested");
    assert.equal(f.launches(), 1);
    assert.equal(
      (await f.app.inject({ url: "/api/preferences", headers: h })).json()
        .recent[0].id,
      "yellow-dogs",
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/apps/yellow-dogs/launch",
          headers: h,
          payload: {},
        })
      ).statusCode,
      429,
    );
  } finally {
    await f.cleanup();
  }
});
test("missing or failed executable never records successful usage", async () => {
  for (const config of [{ missing: true }, { fails: true }]) {
    const f = await fixture(config);
    try {
      const cookie = session(await f.provision());
      const r = await f.app.inject({
        method: "POST",
        url: "/api/apps/yellow-dogs/launch",
        headers: { ...headers, cookie },
        payload: {},
      });
      assert.equal(r.statusCode, config.missing ? 409 : 502);
      assert.deepEqual(
        (
          await f.app.inject({
            url: "/api/preferences",
            headers: { ...headers, cookie },
          })
        ).json().recent,
        [],
      );
    } finally {
      await f.cleanup();
    }
  }
});
test("remote requests cannot launch applications even when authenticated", async () => {
  const f = await fixture();
  try {
    const cookie = session(await f.provision());
    const r = await f.app.inject({
      method: "POST",
      url: "/api/apps/yellow-dogs/launch",
      remoteAddress: "192.168.1.25",
      headers: { ...headers, cookie },
      payload: {},
    });
    assert.equal(r.statusCode, 403);
    assert.equal(f.launches(), 0);
  } finally {
    await f.cleanup();
  }
  const publicApp = await fixture({ remote: true });
  try {
    const r = await publicApp.provision();
    assert.match(String(r.headers["set-cookie"]), /Secure/);
    assert.equal(
      (
        await publicApp.app.inject({
          url: "/api/capabilities",
          headers: publicApp.requestHeaders,
        })
      ).json().nativeLaunch,
      false,
    );
  } finally {
    await publicApp.cleanup();
  }
});
test("expired sessions denied and install plan explicitly unsupported", async () => {
  const f = await fixture();
  try {
    const cookie = session(await f.provision());
    const db = new Database(f.databasePath);
    db.prepare("UPDATE sessions SET expiresAt = 0").run();
    db.close();
    assert.equal(
      (
        await f.app.inject({
          url: "/api/preferences",
          headers: { ...headers, cookie },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/apps", headers })).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/apps",
          headers: { ...headers, cookie },
        })
      ).statusCode,
      401,
    );
    const newCookie = session(await f.provision("another_tester"));
    const plan = await f.app.inject({
      url: "/api/apps/yellow-dogs/installation-plan",
      headers: { ...headers, cookie: newCookie },
    });
    assert.equal(plan.json().supported, false);
    const apps = await f.app.inject({
      url: "/api/apps",
      headers: { ...headers, cookie: newCookie },
    });
    assert.equal(apps.json().apps[0].installed, true);
    assert.ok(!apps.body.includes(f.root));
  } finally {
    await f.cleanup();
  }
});

test("desktop private transport rejects requests without the native token", async () => {
  const f = await fixture({ desktopToken: "test-private-desktop-token" });
  try {
    assert.equal(
      (await f.app.inject({ url: "/api/health", headers })).statusCode,
      403,
    );
    const h = { ...headers, "x-workbox-desktop": "test-private-desktop-token" };
    assert.equal(
      (await f.app.inject({ url: "/api/health", headers: h })).statusCode,
      200,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/apps", headers: h })).statusCode,
      401,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/capabilities", headers: h })).json()
        .mode,
      "desktop",
    );
  } finally {
    await f.cleanup();
  }
});

test("network auth, validation, real loopback TCP, ownership, cancellation and history", async () => {
  const f = await fixture();
  const { createServer } = await import("node:net");
  const listener = createServer((socket) => socket.end());
  await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
  const port = (listener.address() as { port: number }).port;
  try {
    assert.equal(
      (await f.app.inject({ url: "/api/network/history", headers })).statusCode,
      401,
    );
    assert.equal((await f.app.inject({method:"POST",url:"/api/network/identity",headers,payload:{}})).statusCode,401);
    const h = { ...headers, cookie: session(await f.provision()) };
    const other = {
      ...headers,
      cookie: session(await f.provision("other_user")),
    };
    const post = (payload: Record<string, unknown>) =>
      f.app.inject({
        method: "POST",
        url: "/api/network/jobs",
        headers: h,
        payload,
      });
    assert.equal((await post({kind:"speed",target:"speed.nuaa.edu.cn",nodeId:"http://127.0.0.1/arbitrary"})).statusCode,400);
    assert.equal((await f.app.inject({method:"POST",url:"/api/network/identity",headers:h,payload:{},remoteAddress:"192.168.1.1"})).statusCode,403);
    const networkInfo=(await f.app.inject({url:"/api/network/info",headers:h})).json();
    assert.equal(networkInfo.defaultNode,"nuaa");assert.equal(networkInfo.nodes.length,2);assert.ok(Array.isArray(networkInfo.adapters));
    assert.equal(
      (await post({ kind: "tcp", target: "127.0.0.1; calc.exe", port }))
        .statusCode,
      400,
    );
    assert.equal(
      (await post({ kind: "tcp", target: "127.0.0.1", port: 0 })).statusCode,
      400,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/api/network/info",
          headers: h,
          remoteAddress: "192.168.1.1",
        })
      ).statusCode,
      403,
    );
    const created = await post({ kind: "tcp", target: "127.0.0.1", port });
    assert.equal(created.statusCode, 202);
    const id = created.json().job.id;
    assert.equal(
      (await post({ kind: "tcp", target: "127.0.0.1", port })).statusCode,
      409,
    );
    assert.equal(
      (await f.app.inject({ url: "/api/network/jobs/" + id, headers: other }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/network/jobs/" + id + "/cancel",
          headers: other,
          payload: {},
        })
      ).statusCode,
      404,
    );
    let job = created.json().job;
    for (let i = 0; i < 60 && job.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      job = (
        await f.app.inject({ url: "/api/network/jobs/" + id, headers: h })
      ).json().job;
    }
    assert.equal(job.status, "complete");
    assert.equal(job.result.received, 8);
    assert.equal(job.result.lossPercent, 0);
    assert.ok(job.result.latencyMs >= 0);
    assert.equal(
      (await f.app.inject({ url: "/api/network/history", headers: h })).json()
        .reports.length,
      1,
    );
    assert.equal(
      (
        await f.app.inject({ url: "/api/network/history", headers: other })
      ).json().reports.length,
      0,
    );
    const cancel = (
      await post({ kind: "tcp", target: "127.0.0.1", port })
    ).json().job;
    await f.app.inject({
      method: "POST",
      url: "/api/network/jobs/" + cancel.id + "/cancel",
      headers: h,
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(
      (
        await f.app.inject({
          url: "/api/network/jobs/" + cancel.id,
          headers: h,
        })
      ).json().job.status,
      "cancelled",
    );
    const logout = (
      await post({ kind: "tcp", target: "127.0.0.1", port })
    ).json().job;
    await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: h,
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(
      (
        await f.app.inject({
          url: "/api/network/jobs/" + logout.id,
          headers: h,
        })
      ).statusCode,
      401,
    );
    // Closing during a job must finish cancellation before SQLite is closed.
    await f.app.inject({
      method: "POST",
      url: "/api/network/jobs",
      headers: other,
      payload: { kind: "tcp", target: "127.0.0.1", port },
    });
  } finally {
    await f.cleanup();
    await new Promise<void>((r) => listener.close(() => r()));
  }
});

test("network API extracts URL hosts and ports before real TCP probes and history storage", async () => {
  const f = await fixture();
  const { createServer } = await import("node:net");
  const listener = createServer(socket => socket.end());
  await new Promise<void>(done => listener.listen(0, "127.0.0.1", done));
  const port = (listener.address() as { port: number }).port;
  try {
    const h = { ...headers, cookie: session(await f.provision()) };
    const post = (target: string, suppliedPort = 443) => f.app.inject({ method: "POST", url: "/api/network/jobs", headers: h,
      payload: { kind: "tcp", target, port: suppliedPort } });
    for (const target of ["https://user:pass@127.0.0.1/", "file:///C:/test", "127.0.0.1;calc", "http://127.0.0.1:0/", "http:///127.0.0.1/"]) {
      const rejected = await post(target);
      assert.equal(rejected.statusCode, 400, target);
    }
    for (const [target, suppliedPort] of [
      [`https://127.0.0.1:${port}/versus/?private=not-saved#section`, 443],
      [`127.0.0.1:${port}/versus/`, 443],
      ["127.0.0.1/versus/", port],
    ] as const) {
      const response = await post(target, suppliedPort);
      assert.equal(response.statusCode, 202, response.body);
      let job = response.json().job;
      assert.equal(job.result.target, "127.0.0.1");
      assert.equal(job.result.port, port);
      for (let i = 0; i < 80 && job.status === "running"; i++) {
        await new Promise(done => setTimeout(done, 50));
        job = (await f.app.inject({ url: "/api/network/jobs/" + job.id, headers: h })).json().job;
      }
      assert.equal(job.status, "complete");
      assert.equal(job.result.received, 8);
      assert.ok(job.result.samples.every((sample: { address: string }) => sample.address === "127.0.0.1"));
    }
    const history = await f.app.inject({ url: "/api/network/history", headers: h });
    assert.equal(history.json().reports.length, 3);
    assert.ok(history.json().reports.every((report: { result: { target: string; port: number } }) => report.result.target === "127.0.0.1" && report.result.port === port));
    assert.ok(!history.body.includes("versus") && !history.body.includes("private"));
  } finally {
    await f.cleanup();
    await new Promise<void>(done => listener.close(() => done()));
  }
});

test("network statistics never count missing samples as zero latency", async () => {
  const { summarize, validHost } = await import("../server/network");
  const s = summarize([
    { index: 1, address: null, status: "Success", ms: 10 },
    { index: 2, address: null, status: "TimedOut", ms: null },
    { index: 3, address: null, status: "Success", ms: 20 },
    { index: 4, address: null, status: "Success", ms: 26 },
  ]);
  assert.equal(s.lossPercent, 25);
  assert.equal(s.jitterMs, 6);
  assert.equal(s.latencyMs, 18.67);
  assert.equal(
    summarize([{ index: 1, address: null, status: "TimedOut", ms: null }])
      .latencyMs,
    null,
  );
  for (const host of ["localhost", "127.0.0.1", "::1", "example.com"])
    assert.equal(validHost(host), true);
  for (const host of [
    "",
    "-bad.com",
    "https://example.com",
    "host/path",
    "a & calc",
  ])
    assert.equal(validHost(host), false);
});

test("logout in another desktop service cancels a shared-session network job", async () => {
  const f = await fixture();
  const second = await createApp(f.options);
  const { createServer } = await import("node:net");
  const listener = createServer((socket) => socket.end());
  await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
  try {
    const h = { ...headers, cookie: session(await f.provision()) };
    const started = await second.inject({
      method: "POST",
      url: "/api/network/jobs",
      headers: h,
      payload: {
        kind: "tcp",
        target: "127.0.0.1",
        port: (listener.address() as { port: number }).port,
      },
    });
    assert.equal(started.statusCode, 202);
    await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: h,
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 700));
    const db = new Database(f.databasePath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT data FROM network_reports WHERE id=?")
        .get(started.json().job.id) as { data: string };
      assert.equal(JSON.parse(row.data).status, "cancelled");
    } finally {
      db.close();
    }
  } finally {
    await second.close();
    await f.cleanup();
    await new Promise<void>((r) => listener.close(() => r()));
  }
});

test("private local app catalog overrides portable catalog without changing registered entries", async()=>{
  const f=await fixture();
  try{
    await f.app.close();
    const publicFile=join(f.options.root,'config/apps.json');
    writeFileSync(join(f.options.root,'config/apps.local.json'),readFileSync(publicFile));
    writeFileSync(publicFile,JSON.stringify({schemaVersion:1,apps:[]}));
    const app=await createApp(f.options);
    try{
      const login=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{username:'小羊',password:'Workbox-Local-Dev-2026!'}});
      assert.equal(login.statusCode,200);
      const catalog=await app.inject({url:'/api/apps',headers:{...headers,cookie:session(login)}});
      assert.equal(catalog.json().apps.find((a:{id:string})=>a.id==='yellow-dogs').installed,true);
    }finally{await app.close();}
  }finally{await f.cleanup();}
});

test("default Chinese account accepts the public development password and is never reset on restart", async () => {
  const f = await fixture();
  try {
    const login = await f.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { username: "小羊", password: "Workbox-Local-Dev-2026!" },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().user.displayName, "小羊");
    assert.equal(
      (
        await f.app.inject({
          url: "/api/apps",
          headers: { ...headers, cookie: session(login) },
        })
      ).statusCode,
      200,
    );
    const db = new Database(f.databasePath);
    const before = db
      .prepare("SELECT * FROM users WHERE username='小羊'")
      .get() as { id: string; salt: string; passwordHash: string };
    assert.equal(
      scryptSync("Workbox-Local-Dev-2026!", before.salt, 64, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      }).toString("hex"),
      before.passwordHash,
    );
    assert.notEqual(before.passwordHash, "Workbox-Local-Dev-2026!");
    const altered = scryptSync("a-different-test-password", before.salt, 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }).toString("hex");
    db.prepare("UPDATE users SET passwordHash=? WHERE id=?").run(
      altered,
      before.id,
    );
    db.close();
    await f.app.close();
    const reopened = await createApp(f.options);
    try {
      const next = new Database(f.databasePath, { readonly: true });
      try {
        const after = next
          .prepare("SELECT id,passwordHash FROM users WHERE username='小羊'")
          .get() as { id: string; passwordHash: string };
        assert.equal(after.id, before.id);
        assert.equal(after.passwordHash, altered);
      } finally {
        next.close();
      }
    } finally {
      await reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});
