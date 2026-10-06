import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { createApp } from "../server/app";

const run = resolve("runtime", "computer-ui-" + Date.now());
mkdirSync(run, { recursive: true });
const app = await createApp({
  root: process.cwd(),
  databasePath: join(run, "test.sqlite"),
  dataDir: run,
  host: "127.0.0.1",
  origin: "http://127.0.0.1:4341",
  platform: "win32",
  computerProbe: resolve("desktop-dev/ComputerProbe.exe"),
  launcher: async () => {},
});
await app.listen({ host: "127.0.0.1", port: 4341 });
const origin = "http://127.0.0.1:4341";
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [],
  checks: string[] = [];
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 821 },
  });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/?window=computer");
  assert.equal(await page.getByLabel("电脑信息仪表盘").count(), 0);
  await page.getByLabel("密码", { exact: true }).fill("Workbox-Local-Dev-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("实时 · 1 秒", { exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="CPU 性能"] strong')?.textContent !==
      "—%",
  );
  assert.ok(
    (await page.locator(".computer-device").innerText()).includes("Intel"),
  );
  checks.push("authenticated dashboard uses actual native CPU/RAM/GPU samples");
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await page.screenshot({
    path: join(run, "dashboard-light.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.setViewportSize({ width: 1104, height: 681 });
  await page.screenshot({
    path: join(run, "dashboard-dark-min.png"),
    fullPage: true,
  });
  const bounds = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > innerWidth,
    footer: document.querySelector(".computer-footer")!.getBoundingClientRect()
      .bottom,
  }));
  assert.equal(bounds.overflowX, false);
  assert.ok(bounds.footer <= 681, "dashboard fits minimum native client area");
  checks.push("light/dark dashboard fits minimum window");
  const adapters = await page
    .getByLabel("监测网卡")
    .locator("option")
    .allTextContents();
  assert.ok(adapters.length > 1);
  await page.getByLabel("监测网卡").selectOption({ index: 1 });
  checks.push("real network adapters selectable");
  await page.getByRole('button',{name:'查看CPU详情',exact:true}).click();
  await page.getByRole('navigation',{name:'硬件分类'}).waitFor();
  assert.equal(await page.locator('.hardware-processors article').count(),20);
  await page.getByLabel('逻辑处理器排序').selectOption('load');
  await page.screenshot({path:join(run,'cpu-details-dark.png'),fullPage:true});
  for(const category of ['显卡','内存','磁盘','网卡','主板与电池']){
    await page.getByRole('button',{name:category,exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:join(run,'detail-'+category+'.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'功率估算',exact:true}).click();
  await page.getByText('功耗构成',{exact:true}).waitFor();
  await page.getByLabel('其他部件 · W').fill('60');
  await page.getByRole('button',{name:'保存估算参数',exact:true}).click();
  await page.getByText('参数已保存',{exact:true}).waitFor();
  await page.screenshot({path:join(run,'power-estimate-dark.png'),fullPage:true});
  await page.getByRole('button',{name:'仪表盘',exact:true}).click();
  checks.push('20 logical processors, device details, persistent configurable power estimates');
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/computer/snapshot")) reads++;
  });
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.waitForTimeout(200);
  const pausedReads = reads;
  await page.waitForTimeout(1800);
  assert.equal(reads, pausedReads);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.waitForTimeout(1300);
  assert.ok(reads > pausedReads);
  checks.push("pause stops requests; resume restarts");
  await page.getByRole("button", { name: "悬浮窗", exact: true }).click();
  await page.getByLabel("悬浮窗显示方式").selectOption("mini");
  await page.getByLabel("悬浮窗位置").selectOption("bottom-left");
  await page.getByLabel("悬浮窗不透明度").fill("0.65");
  await page.getByText("65%", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "保存设置", exact: true })
      .isDisabled(),
    true,
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: join(run, "settings-dark-min.png"),
    fullPage: true,
  });
  checks.push(
    "overlay settings controls render and browser cannot register native shortcuts",
  );
  // A bridge contract test, not a claim that Playwright drives Windows hotkeys.
  await page.addInitScript(`
    const listeners=new Set();const saved={hotkey:'Ctrl+Alt+R',mode:'compact',anchor:'top-right',opacity:.88,closeToTray:true};
    Object.defineProperty(window,'workboxNative',{value:true});window.__nativeMessages=[];
    if(!window.chrome)Object.defineProperty(window,'chrome',{value:{},configurable:true});Object.defineProperty(window.chrome,'webview',{value:{addEventListener:(type,f)=>listeners.add(f),removeEventListener:(type,f)=>listeners.delete(f),postMessage:m=>{window.__nativeMessages.push(m);if(m.action==='computer-sync')queueMicrotask(()=>listeners.forEach(f=>f({data:{type:'computer-state',visible:false,available:true,settings:saved}})));if(m.action==='computer-save')queueMicrotask(()=>listeners.forEach(f=>f({data:{type:'computer-saved',requestId:m.requestId,settings:m.settings}})));}},configurable:true});
  `);
  await page.reload();
  await page.getByRole("button", { name: "悬浮窗", exact: true }).click();
  await page.getByRole("button", { name: "修改", exact: true }).click();
  await page
    .getByRole("button", { name: "录制悬浮窗快捷键", exact: true })
    .press("Control+Alt+m");
  assert.equal(
    await page
      .getByRole("button", { name: "录制悬浮窗快捷键", exact: true })
      .textContent(),
    "Ctrl + Alt + M",
  );
  await page.getByRole("button", { name: "完成录制", exact: true }).click();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  assert.ok(
    (await page.evaluate(() => (window as any).__nativeMessages)).some(
      (m: any) =>
        m.action === "computer-save" && m.settings.hotkey === "Ctrl+Alt+M",
    ),
    JSON.stringify(await page.evaluate(() => (window as any).__nativeMessages)),
  );
  checks.push(
    "custom hotkey recording and correlated native save bridge contract",
  );
  await page.goto(origin + "/");
  await page
    .getByRole("heading", { name: "小羊图片工坊", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "小羊电脑信息", exact: true })
    .waitFor();
  const response = page.waitForResponse(
    (r) => r.url() === origin + "/api/apps",
  );
  await page.getByRole("button", { name: "刷新应用", exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.screenshot({
    path: join(run, "catalog-dark.png"),
    fullPage: true,
  });
  checks.push(
    "image workshop and computer info entries visible; explicit catalog refresh",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    join(run, "results.json"),
    JSON.stringify({ checks, errors, bounds, adapters }, null, 2),
  );
  console.log("Computer UI passed: " + run);
} finally {
  await browser?.close();
  await app.close();
}
