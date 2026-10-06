import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../server/app";

const run = resolve("runtime", "network-target-ui-" + Date.now());
mkdirSync(run, { recursive: true });
const tcpServer = createServer(socket => socket.end());
tcpServer.listen(0, "127.0.0.1");
await once(tcpServer, "listening");
const tcpPort = (tcpServer.address() as { port: number }).port;
const origin = "http://127.0.0.1:4333";
const app = await createApp({ root: process.cwd(), databasePath: resolve(run, "test.sqlite"),
  host: "127.0.0.1", origin, platform: "win32", launcher: async () => {}, logger: false,
  probePath: resolve("desktop-dev/NetworkProbe.exe") });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [], checks: string[] = [];
try {
  await app.listen({ host: "127.0.0.1", port: 4333 });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  page.on("pageerror", error => errors.push(error.message));
  const submissions: unknown[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().endsWith("/api/network/jobs")) submissions.push(request.postDataJSON());
  });
  const waitUntil = async (check: () => Promise<boolean>, timeout = 10000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await check()) return; await page.waitForTimeout(100); }
    throw new Error("UI condition did not settle");
  };
  await page.goto(origin + "/?window=network");
  await page.getByLabel("密码", { exact: true }).fill("Workbox-Local-Dev-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const start = page.getByRole("button", { name: "开始测试", exact: true });
  await start.waitFor();
  await page.getByRole("button", { name: "Ping", exact: true }).click();
  await page.getByLabel("目标", { exact: true }).fill("yellowdogsleague.online/versus/");
  for (const tab of ["DNS", "TCP", "路由追踪", "测速", "历史记录", "Ping"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    if (!["测速", "历史记录"].includes(tab))
      assert.equal(await page.getByLabel(tab === "DNS" ? "域名" : "目标", { exact: true }).inputValue(), "yellowdogsleague.online/versus/");
  }
  checks.push("pasted game URL retained across DNS, TCP, trace, speed and history tabs");

  await page.getByLabel("目标", { exact: true }).fill("https://user:pass@127.0.0.1/");
  await start.click();
  assert.match(await page.getByRole("alert").innerText(), /请输入有效/);
  assert.equal(submissions.length, 0);
  await page.getByLabel("目标", { exact: true }).fill("https://127.0.0.1/versus/?ignored=1#section");
  assert.equal(await page.getByRole("alert").count(), 0);
  const pingCreated = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/network/jobs"));
  await start.click();
  assert.equal((await pingCreated).status(), 202);
  await waitUntil(async () => (await page.locator(".result-heading").innerText()).includes("完成"));
  assert.equal(await page.getByLabel("目标", { exact: true }).inputValue(), "127.0.0.1");
  assert.match(await page.locator(".metrics").innerText(), /10 \/ 10/);
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.screenshot({ path: resolve(run, "ping-url-light.png"), fullPage: true });
  checks.push("invalid URL rejected before request; corrected full URL starts real native loopback Ping with 10/10 replies");

  await page.getByRole("button", { name: "TCP", exact: true }).click();
  assert.equal(await page.getByLabel("目标", { exact: true }).inputValue(), "127.0.0.1");
  await page.getByLabel("目标", { exact: true }).fill(`127.0.0.1:${tcpPort}/versus/`);
  const tcpCreated = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/network/jobs"));
  await start.click();
  assert.equal((await tcpCreated).status(), 202);
  await waitUntil(async () => (await page.locator(".result-heading").innerText()).includes("完成"));
  assert.equal(await page.getByLabel("目标", { exact: true }).inputValue(), "127.0.0.1");
  assert.equal(await page.getByLabel("端口", { exact: true }).inputValue(), String(tcpPort));
  assert.match(await page.locator(".metrics").innerText(), /8 \/ 8/);
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await waitUntil(async () => await page.getByRole("button", { name: "深色", exact: true }).getAttribute("aria-pressed") === "true");
  await page.waitForTimeout(180);
  await page.screenshot({ path: resolve(run, "tcp-url-dark.png"), fullPage: true });
  checks.push("scheme-less URL uses embedded TCP port; 8/8 real loopback connections; compact light/dark UI");

  const reports = (await (await page.request.get(origin + "/api/network/history")).json()).reports;
  assert.equal(reports.length, 2);
  assert.ok(reports.every((report: { result: { target: string } }) => report.result.target === "127.0.0.1"));
  assert.ok(!JSON.stringify(reports).includes("versus"));
  assert.deepEqual(errors, []);
  writeFileSync(resolve(run, "results.json"), JSON.stringify({ checks, submissions, reports, errors }, null, 2));
  console.log(JSON.stringify({ run, checks, errors }));
} finally {
  await browser?.close();
  await app.close();
  await new Promise<void>(done => tcpServer.close(() => done()));
  for (const suffix of ["", "-wal", "-shm"]) rmSync(resolve(run, "test.sqlite" + suffix), { force: true });
}
