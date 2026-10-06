import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Database from "better-sqlite3";
import {
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { User, Preferences } from "../shared/types";
import { registerNetwork } from "./network";
import { registerRooms } from "./rooms";
import { registerImages } from "./images";
import { registerOcr } from "./ocr";
import { AppRuntimeController, type RuntimeController } from "./app-runtime";
import { registerComputer, type ComputerSampler } from "./computer";
import { registerPhotos } from "./photos";
import { registerScreenshots, type ScreenshotOptions } from "./screenshots";
import { defaultAccount, type InitialAccount } from "./default-account";
import {
  DEFAULT_CAPTURE_HOTKEY,
  normalizeCaptureHotkey,
} from "../shared/hotkey";

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "请输入账号")
  .max(24, "账号不能超过24位");
const password = z.string().min(1, "请输入密码").max(128, "密码不能超过128位");
const loginSchema = z.object({ username, password });
const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  apps: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      platform: z.literal("windows"),
      version: z.string().nullable(),
      integration: z.literal("external"),
      lifecycle: z.object({ detection: z.enum(["process", "window"]) }).optional(),
      entry: z.object({
        type: z.literal("executable"),
        path: z.string(),
        args: z.array(z.string()),
      }),
    }),
  ),
});
type ExternalCatalogItem = z.infer<typeof catalogSchema>["apps"][number];
type CatalogItem =
  | ExternalCatalogItem
  | (Omit<ExternalCatalogItem, "integration" | "entry"> & {
      integration: "managed";
      entry: { type: "page"; page: "screenshots" };
    });
type StoredUser = User & { salt: string; passwordHash: string };
const loopback = (s: string) =>
  ["127.0.0.1", "::1", "[::1]", "localhost", "::ffff:127.0.0.1"].includes(s);
const hashToken = (s: string) => createHash("sha256").update(s).digest("hex");
const derive = (p: string, salt: string) =>
  new Promise<Buffer>((ok, fail) =>
    scrypt(
      p,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, key) => (e ? fail(e) : ok(key)),
    ),
  );
const publicUser = ({
  id,
  username,
  displayName,
  createdAt,
}: StoredUser): User => ({ id, username, displayName, createdAt });
const defaultPreferences = (): Preferences => ({
  favorites: [],
  recent: [],
  theme: "system",
  captureHotkey: DEFAULT_CAPTURE_HOTKEY,
  minimizeOnCapture: true,
});
const nativeLauncher = (entry: ExternalCatalogItem["entry"]) =>
  new Promise<void>((ok, fail) => {
    const child = spawn(entry.path, entry.args, {
      cwd: dirname(entry.path),
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("error", fail);
    child.once("spawn", () => {
      child.unref();
      ok();
    });
  });
export interface AppOptions {
  root: string;
  databasePath: string;
  initialAccount?: InitialAccount;
  origin: string;
  host?: string;
  devOrigin?: string;
  platform?: string;
  launcher?: typeof nativeLauncher;
  logger?: boolean;
  desktopToken?: string;
  networkExe?: string;
  roomExe?: string;
  imageExe?: string;
  computerExe?: string;
  computerProbe?: string;
  ocrExe?: string;
  appController?: RuntimeController;
  computerSampler?: Pick<ComputerSampler, "snapshot" | "dispose">;
  nativeFilesToken?: string;
  rawExe?: string;
  probePath?: string;
  dataDir?: string;
  sharexSource?: string;
  captureBridge?: string;
  screenshotAdapter?: Pick<ScreenshotOptions, "launch" | "thumbnail">;
}
export async function createApp(options: AppOptions) {
  const origin = new URL(options.origin).origin;
  const local =
    loopback(options.host ?? "127.0.0.1") && loopback(new URL(origin).hostname);
  if (!local && !origin.startsWith("https://"))
    throw new Error("非本机部署必须配置 HTTPS WORKBOX_ORIGIN");
  const nativeEnabled =
    local && (options.platform ?? process.platform) === "win32";
  const allowedOrigins = new Set([origin]);
  if (options.devOrigin) {
    const dev = new URL(options.devOrigin);
    if (!local || !loopback(dev.hostname))
      throw new Error("开发来源只能用于本机服务");
    allowedOrigins.add(dev.origin);
  }
  const allowedHosts = new Set([...allowedOrigins].map((v) => new URL(v).host));
  const catalog: CatalogItem[] = catalogSchema.parse(
    JSON.parse(readFileSync(resolve(options.root, existsSync(resolve(options.root,"config/apps.local.json"))?"config/apps.local.json":"config/apps.json"), "utf8")),
  ).apps;
  // Fixed sibling binaries work with older hosts and the local development server.
  // Re-evaluate on list/launch so new tools do not depend on captured startup env.
  const bundledRoot = existsSync(resolve(options.root, "server.cjs"))
    ? resolve(options.root, "..")
    : resolve(options.root, "desktop-dev");
  const builtinIds = new Set<string>();
  function refreshBundledApps() {
    for (const [id, name, category, version, explicit] of [
      [
        "xiaoyang-network",
        "小羊网络测试",
        "网络工具",
        "0.2.0",
        options.networkExe,
      ],
      ["xiaoyang-room", "小羊房间设计", "设计工具", "0.1.0", options.roomExe],
      [
        "xiaoyang-images",
        "小羊图片工坊",
        "图片工具",
        "0.2.0",
        options.imageExe,
      ],
      [
        "xiaoyang-computer",
        "小羊电脑信息",
        "系统工具",
        "0.1.0",
        options.computerExe,
      ],
      ["xiaoyang-video", "小羊视频播放器", "影音工具", "0.1.0", undefined],
    ] as const) {
      const path = explicit ?? resolve(bundledRoot, name + ".exe");
      if (!explicit && !existsSync(path)) continue;
      const index = catalog.findIndex((item) => item.id === id);
      if (index >= 0 && !builtinIds.has(id)) continue;
      const item: CatalogItem = {
        id,
        name,
        description: "",
        category,
        platform: "windows",
        version,
        integration: "external",
        entry: {
          type: "executable",
          path,
          args: options.dataDir ? [`--data-dir=${options.dataDir}`] : [],
        },
      };
      if (index < 0) catalog.push(item);
      else catalog[index] = item;
      builtinIds.add(id);
    }
  }
  refreshBundledApps();
  const appRuntime =
    options.appController ??
    new AppRuntimeController(resolve(bundledRoot, "AppControl.exe"));
  const runtimeEntry = (tool: CatalogItem) => ({
    id: tool.id,
    path: tool.entry.type === "executable" ? tool.entry.path : "",
    managed: [
      "xiaoyang-network",
      "xiaoyang-room",
      "xiaoyang-images",
      "xiaoyang-computer",
      "xiaoyang-video",
    ].includes(tool.id),
    ...(tool.lifecycle ? { detection: tool.lifecycle.detection } : {}),
  });
  catalog.push({
    id: "sharex",
    name: "ShareX",
    description: "",
    category: "截图工具",
    platform: "windows",
    version: "21.0.0",
    integration: "managed",
    entry: { type: "page", page: "screenshots" },
  });
  if (new Set(catalog.map((t) => t.id)).size !== catalog.length)
    throw new Error("重复的工具 id");
  for (const item of catalog)
    if (
      item.entry.type === "executable" &&
      (!isAbsolute(item.entry.path) ||
        !item.entry.path.toLowerCase().endsWith(".exe"))
    )
      throw new Error("工具必须登记绝对 exe 路径");
  if (options.databasePath !== ":memory:")
    mkdirSync(dirname(options.databasePath), { recursive: true });
  const db = new Database(options.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, displayName TEXT NOT NULL, salt TEXT NOT NULL, passwordHash TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences (userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expiresAt);`);
  const bootstrap = options.initialAccount ?? defaultAccount;
  db.prepare("INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?)").run(
    randomUUID(),
    bootstrap.username,
    bootstrap.displayName,
    bootstrap.salt,
    bootstrap.passwordHash,
    Date.now(),
  );
  db.prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(Date.now());
  const dummySalt = randomBytes(16).toString("hex");
  const dummyHash = await derive(randomBytes(24).toString("hex"), dummySalt);
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16 * 1024,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "操作太频繁，请稍后再试。",
    }),
  });
  app.addHook("onClose", async () => {
    appRuntime.dispose();
    db.close();
  });
  app.addHook("onRequest", async (req, reply) => {
    if (
      options.desktopToken &&
      req.headers["x-workbox-desktop"] !== options.desktopToken
    )
      return reply.code(403).send({ error: "请使用桌面应用。" });
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (!allowedHosts.has(req.headers.host ?? ""))
      return reply.code(403).send({ error: "访问地址不受信任。" });
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !allowedOrigins.has(req.headers.origin ?? "")
    )
      return reply
        .code(403)
        .send({ error: "请求来源无效，请从工作箱页面重试。" });
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: err.issues[0]?.message ?? "输入格式有误。" });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500)
      req.log.error(
        { code: (err as { code?: string }).code },
        "Workbox request failed",
      );
    return reply.code(status).send({
      error:
        status === 429
          ? "操作太频繁，请稍后再试。"
          : status >= 500
            ? "服务暂时无法完成操作，请重试。"
            : "请求格式不正确。",
    });
  });
  const sessionUser = (req: FastifyRequest): StoredUser | undefined => {
    const token = req.cookies.workbox_session;
    if (!token) return;
    return db
      .prepare(
        "SELECT users.* FROM users JOIN sessions ON users.id = sessions.userId WHERE tokenHash = ? AND expiresAt > ?",
      )
      .get(hashToken(token), Date.now()) as StoredUser | undefined;
  };
  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!sessionUser(req))
      return reply.code(401).send({ error: "请先登录小羊账号。" });
  };
  const newSession = (user: User, req: FastifyRequest, reply: FastifyReply) => {
    const old = req.cookies.workbox_session;
    if (old)
      db.prepare("DELETE FROM sessions WHERE tokenHash = ?").run(
        hashToken(old),
      );
    db.prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    const age = 7 * 24 * 60 * 60;
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
      hashToken(token),
      user.id,
      Date.now() + age * 1000,
    );
    reply.setCookie("workbox_session", token, {
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "strict",
      path: "/",
      maxAge: age,
    });
  };
  const prefs = (id: string): Preferences => {
    const row = db
      .prepare("SELECT data FROM preferences WHERE userId = ?")
      .get(id) as { data: string } | undefined;
    return row
      ? { ...defaultPreferences(), ...JSON.parse(row.data) }
      : defaultPreferences();
  };
  const savePrefs = (id: string, p: Preferences) =>
    db
      .prepare(
        "INSERT INTO preferences VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET data = excluded.data",
      )
      .run(id, JSON.stringify(p));
  const localRequest = (req: FastifyRequest) =>
    nativeEnabled && loopback(req.ip);
  registerRooms(app, {
    db,
    authorize: authenticate,
    userId: (req) => sessionUser(req)!.id,
  });
  const images = registerImages(app, {
    dataDir: options.dataDir ?? resolve(options.root, "runtime"),
    nativeFilesToken: options.nativeFilesToken,
    authorize: authenticate,
    userId: (req) => sessionUser(req)?.id,
    local: localRequest,
  });
  const photos = registerPhotos(app, {
    db,
    dataDir: options.dataDir ?? resolve(options.root, "runtime"),
    rawExe:
      options.rawExe ??
      resolve(
        options.root,
        "desktop-dev/components/LibRaw-0.22.2/RawPhoto.exe",
      ),
    nativeFilesToken: options.nativeFilesToken,
    authorize: authenticate,
    userId: (req) => sessionUser(req)?.id,
    local: localRequest,
  });
  const computer = registerComputer(app, {
    db,
    exe: options.computerProbe ?? resolve(bundledRoot, "ComputerProbe.exe"),
    nativeToken: options.nativeFilesToken,
    authorize: authenticate,
    userId: (req) => sessionUser(req)?.id,
    local: localRequest,
    sampler: options.computerSampler,
  });
  const ocr = registerOcr(app, {
    exe:
      options.ocrExe ??
      resolve(bundledRoot, "components/Tesseract-5.5.3/tesseract.exe"),
    dataDir: options.dataDir ?? resolve(options.root, "runtime"),
    authorize: authenticate,
    userId: (req) => sessionUser(req)?.id,
    local: localRequest,
  });
  const network = registerNetwork(app, {
    db,
    root: options.root,
    userId: (req) => sessionUser(req)?.id,
    authorize: authenticate,
    local: localRequest,
    probePath: options.probePath,
  });
  const screenshots = registerScreenshots(app, {
    db,
    dataDir: options.dataDir ?? resolve(options.root, "runtime"),
    source: options.sharexSource,
    bridge: options.captureBridge,
    nativeFilesToken: options.nativeFilesToken,
    userId: (req) => sessionUser(req)?.id,
    authorize: authenticate,
    local: localRequest,
    ...options.screenshotAdapter,
  });
  const installed = (item: CatalogItem) => {
    if (item.entry.type === "page")
      return (
        !!options.sharexSource &&
        existsSync(resolve(options.sharexSource, "ShareX.exe")) &&
        !!options.captureBridge &&
        existsSync(options.captureBridge)
      );
    try {
      return statSync(item.entry.path).isFile();
    } catch {
      return false;
    }
  };
  app.get("/api/health", async () => ({
    ok: true,
    service: "xiaoyang-workbox",
  }));
  app.get("/api/capabilities", async (req) => ({
    registration: false,
    nativeLaunch: localRequest(req),
    installer: { supported: false, apiVersion: 1 },
    mode: options.desktopToken ? "desktop" : local ? "local" : "web",
    version: "0.2.0",
  }));
  app.get("/api/session", async (req) => ({
    user: sessionUser(req) ? publicUser(sessionUser(req)!) : null,
  }));
  const authLimit = app.rateLimit({ max: 10, timeWindow: 60_000 });
  app.post("/api/auth/register", async (_req, reply) =>
    reply.code(403).send({ error: "注册已关闭。" }),
  );
  app.post("/api/auth/login", { preHandler: authLimit }, async (req, reply) => {
    const data = loginSchema.parse(req.body);
    const user = db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(data.username) as StoredUser | undefined;
    const key = await derive(data.password, user?.salt ?? dummySalt);
    if (
      !timingSafeEqual(
        key,
        user ? Buffer.from(user.passwordHash, "hex") : dummyHash,
      ) ||
      !user
    )
      return reply.code(401).send({ error: "账号或密码不正确。" });
    newSession(user, req, reply);
    return { user: publicUser(user) };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const user = sessionUser(req);
    if (user) {
      computer.releaseOwner(user.id);
      await ocr.releaseOwner(user.id);
      network.cancelOwner(user.id);
      screenshots.releaseOwner(user.id);
      await images.releaseOwner(user.id);
      await photos.releaseOwner(user.id);
    }
    if (req.cookies.workbox_session)
      db.prepare("DELETE FROM sessions WHERE tokenHash = ?").run(
        hashToken(req.cookies.workbox_session),
      );
    reply.clearCookie("workbox_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/preferences", { preHandler: authenticate }, async (req) =>
    prefs(sessionUser(req)!.id),
  );
  app.patch("/api/preferences", { preHandler: authenticate }, async (req) => {
    const data = z
      .object({
        favorites: z.array(z.string()).max(100).optional(),
        theme: z.enum(["system", "light", "dark"]).optional(),
        closeToTray: z.boolean().optional(),
        minimizeOnCapture: z.boolean().optional(),
        captureHotkey: z
          .string()
          .max(50)
          .transform((value, context) => {
            const normalized = normalizeCaptureHotkey(value);
            if (!normalized) {
              context.addIssue({ code: "custom", message: "不支持这个快捷键" });
              return z.NEVER;
            }
            return normalized;
          })
          .optional(),
      })
      .strict()
      .parse(req.body);
    const user = sessionUser(req)!;
    const p = prefs(user.id);
    if (data.favorites)
      p.favorites = [...new Set(data.favorites)].filter((id) =>
        catalog.some((t) => t.id === id),
      );
    if (data.theme) p.theme = data.theme;
    if (data.closeToTray !== undefined) p.closeToTray = data.closeToTray;
    if (data.minimizeOnCapture !== undefined)
      p.minimizeOnCapture = data.minimizeOnCapture;
    if (data.captureHotkey !== undefined) p.captureHotkey = data.captureHotkey;
    savePrefs(user.id, p);
    return p;
  });
  app.get("/api/apps", { preHandler: authenticate }, async (req) => {
    refreshBundledApps();
    const states = localRequest(req)
      ? await appRuntime.list(
          catalog
            .filter((t) => t.entry.type === "executable")
            .map(runtimeEntry),
        )
      : {};
    return {
      apps: catalog.map(({ entry: _entry, ...item }) => ({
        ...item,
        runtime:
          item.integration === "managed"
            ? {
                state: "embedded",
                instances: 0,
                since: null,
                canClose: false,
                canShow: true,
              }
            : (states[item.id] ?? {
                state: "unknown",
                instances: 0,
                since: null,
                canClose: false,
                canShow: false,
              }),
        installed:
          localRequest(req) &&
          installed(catalog.find((t) => t.id === item.id)!),
        launchable:
          localRequest(req) &&
          installed(catalog.find((t) => t.id === item.id)!),
      })),
    };
  });
  const launches = new Map<string, number>();
  app.post<{ Params: { id: string } }>(
    "/api/apps/:id/launch",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 15, timeWindow: 60_000 } },
    },
    async (req, reply) => {
      refreshBundledApps();
      const tool = catalog.find((t) => t.id === req.params.id);
      if (!tool) return reply.code(404).send({ error: "没有找到这个工具。" });
      if (!localRequest(req))
        return reply
          .code(403)
          .send({ error: "请在 Windows 本机工作箱中打开客户端。" });
      if (!installed(tool))
        return reply
          .code(409)
          .send({ error: "没有找到客户端，请检查登记的安装位置。" });
      const now = Date.now();
      if (now - (launches.get(tool.id) ?? 0) < 2500)
        return reply.code(429).send({ error: "启动请求已发出，请稍候。" });
      launches.set(tool.id, now);
      try {
        if (tool.entry.type === "executable") {
          const existing = (await appRuntime.list([runtimeEntry(tool)], true))[
            tool.id
          ];
          if (existing?.state === "running" || existing?.state === "closing") {
            if (!(await appRuntime.action(runtimeEntry(tool), "show")))
              return reply
                .code(409)
                .send({ error: "应用正在后台运行，请通过其托盘打开" });
          } else {
            const entry =
              tool.id === "xiaoyang-chess"
                ? {
                    ...tool.entry,
                    args: [
                      ...tool.entry.args,
                      `--theme=${prefs(sessionUser(req)!.id).theme}`,
                    ],
                  }
                : tool.entry;
            await (options.launcher ?? nativeLauncher)(entry);
            appRuntime.starting(tool.id);
          }
        }
      } catch {
        launches.delete(tool.id);
        return reply
          .code(502)
          .send({ error: "客户端未能启动，请检查文件及访问权限。" });
      }
      const user = sessionUser(req)!;
      const p = prefs(user.id);
      p.recent = [
        { id: tool.id, at: now },
        ...p.recent.filter((t) => t.id !== tool.id),
      ].slice(0, 20);
      savePrefs(user.id, p);
      return {
        status: "requested",
        requestedAt: now,
        ...(tool.entry.type === "page" ? { page: tool.entry.page } : {}),
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/apps/:id/close",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!localRequest(req))
        return reply.code(403).send({ error: "仅限 Windows 本机应用管理" });
      const tool = catalog.find((t) => t.id === req.params.id);
      if (!tool) return reply.code(404).send({ error: "没有找到这个工具" });
      if (tool.entry.type !== "executable")
        return reply.code(409).send({ error: "此工具在工作箱内运行" });
      if (!(await appRuntime.action(runtimeEntry(tool), "close")))
        return reply
          .code(409)
          .send({ error: "应用已退出或暂不支持关闭，请通过应用托盘退出" });
      return { status: "closing" };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/apps/:id/installation-plan",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!catalog.some((t) => t.id === req.params.id))
        return reply.code(404).send({ error: "没有找到这个工具。" });
      return {
        supported: false,
        reason:
          "当前为开发版本，暂不提供安装包。请使用已安装的 Windows 客户端。",
      };
    },
  );
  const webRoot = resolve(options.root, "dist");
  if (existsSync(webRoot))
    await app.register(staticFiles, { root: webRoot, index: "index.html" });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: "没有找到这个页面或接口。" }),
  );
  return app;
}
