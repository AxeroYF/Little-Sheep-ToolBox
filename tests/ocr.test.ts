import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createApp } from "../server/app";
import type { OcrJob } from "../shared/ocr";
const origin = "http://127.0.0.1:4348",
  headers = { host: "127.0.0.1:4348", origin };
test(
  "real offline Chinese/English OCR, auth, bounded inputs, cancellation and temporary cleanup",
  { timeout: 60000 },
  async () => {
    mkdirSync("runtime", { recursive: true });
    const dir = mkdtempSync(resolve("runtime/ocr-test-")),
      input = join(dir, "fixture.png");
    mkdirSync(join(dir, "config"));
    writeFileSync(
      join(dir, "config/apps.json"),
      ' {"schemaVersion":1,"apps":[]}',
    );
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        resolve("tests/create-ocr-fixture.ps1"),
        "-Path",
        input,
      ],
      { windowsHide: true },
    );
    const body = readFileSync(input),
      hash = createHash("sha256").update(body).digest("hex");
    const app = await createApp({
      root: dir,
      databasePath: join(dir, "test.sqlite"),
      dataDir: dir,
      origin,
      host: "127.0.0.1",
      platform: "win32",
      ocrExe: resolve("desktop-dev/components/Tesseract-5.5.3/tesseract.exe"),
    });
    try {
      assert.equal(
        (await app.inject({ url: "/api/ocr/status", headers })).statusCode,
        401,
      );
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers,
        payload: { username: "小羊", password: "Workbox-Local-Dev-2026!" },
      });
      const auth = {
        ...headers,
        cookie: String(login.headers["set-cookie"]).split(";")[0],
      };
      assert.equal(
        (await app.inject({ url: "/api/ocr/status", headers: auth })).json()
          .available,
        true,
      );
      const start = (data: Buffer, id = randomUUID(), query = "") =>
        app.inject({
          method: "POST",
          url: `/api/ocr/recognize?id=${id}&language=chi_sim%2Beng&layout=block${query}`,
          headers: { ...auth, "content-type": "application/octet-stream" },
          payload: data,
        });
      assert.equal(
        (await start(body, randomUUID(), "&path=C:/Windows/test.png"))
          .statusCode,
        400,
      );
      const submitted = await start(body);
      assert.equal(submitted.statusCode, 202);
      const id = submitted.json().id;
      assert.equal((await start(body)).statusCode, 409);
      let job: OcrJob;
      const wait = async () => {
        for (let i = 0; i < 130; i++) {
          job = (
            await app.inject({ url: "/api/ocr/status", headers: auth })
          ).json().job;
          if (job.status !== "running") return job;
          await new Promise((r) => setTimeout(r, 200));
        }
        throw Error("OCR test timed out");
      };
      const done = await wait();
      assert.equal(done.id, id);
      assert.equal(done.status, "complete", done.error ?? "");
      assert.match(done.text, /WORKBOX OCR 2026/);
      assert.match(done.text.replace(/\s/g, ""), /小羊文字识别测试/);
      await new Promise((r) => setTimeout(r, 100));
      assert.deepEqual(readdirSync(join(dir, "ocr-temp")), []);
      assert.equal(
        createHash("sha256").update(readFileSync(input)).digest("hex"),
        hash,
      );
      const cancelled = await start(body);
      assert.equal(cancelled.statusCode, 202);
      const stop = await app.inject({
        method: "POST",
        url: "/api/ocr/" + cancelled.json().id + "/cancel",
        headers: auth,
        payload: {},
      });
      assert.equal(stop.json().status, "cancelled");
      assert.deepEqual(readdirSync(join(dir, "ocr-temp")), []);
      assert.equal((await start(Buffer.from("invalid image"))).statusCode, 202);
      assert.equal((await wait()).status, "failed");
      assert.deepEqual(readdirSync(join(dir, "ocr-temp")), []);
      const last = await start(body);
      assert.equal(last.statusCode, 202);
      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: auth,
        payload: {},
      });
      assert.deepEqual(readdirSync(join(dir, "ocr-temp")), []);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
