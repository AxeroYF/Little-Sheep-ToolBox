import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import {
  promises as fs,
  existsSync,
  mkdirSync,
  createReadStream,
  renameSync,
} from "node:fs";
import {
  join,
  resolve,
  relative,
  isAbsolute,
  dirname,
  basename,
} from "node:path";
import { z } from "zod";
import type { CaptureMode, Screenshot } from "../shared/screenshots";
import { SharexEngine } from "./sharex-engine";

const execute = promisify(execFile);
const active = "status IN ('starting','running')";
const uuid = z.string().uuid();
type Job = {
  id: string;
  userId: string;
  mode: CaptureMode;
  status: string;
  parentId: string | null;
  pid: number;
  hostPid: number;
  createdAt: number;
  error: string;
  imageId: string | null;
};
type Row = Omit<Screenshot, "favorite"> & {
  userId: string;
  favorite: number;
  jobId: string;
  hash: string;
  fileName: string;
};
export interface ScreenshotOptions {
  db: Database.Database;
  dataDir: string;
  source?: string;
  bridge?: string;
  nativeFilesToken?: string;
  userId: (r: FastifyRequest) => string | undefined;
  authorize: (r: FastifyRequest, s: FastifyReply) => unknown;
  local: (r: FastifyRequest) => boolean;
  // Test seam; production always uses fixed executables, never request paths.
  launch?: (exe: string, args: string[], cwd: string) => ChildProcess;
  thumbnail?: (
    source: string,
    target: string,
  ) => Promise<{ width: number; height: number }>;
}
const publicImage = (r: Row): Screenshot => ({
  id: r.id,
  title: r.title,
  category: r.category,
  favorite: !!r.favorite,
  createdAt: r.createdAt,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  parentId: r.parentId,
  deletedAt: r.deletedAt,
});
const alive = (pid: number) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
export function sharexSettings(
  output: string,
  receipt: string,
  bridge: string,
) {
  return {
    ApplicationVersion: "21.0.0",
    DisableUpload: true,
    AutoCheckUpdate: false,
    ShowTray: true,
    SilentRun: true,
    FirstTimeMinimizeToTray: false,
    HistorySaveTasks: false,
    UseCustomScreenshotsPath: true,
    CustomScreenshotsPath: output,
    SaveImageSubFolderPattern: "",
    SaveImageSubFolderPatternWindow: "",
    DefaultTaskSettings: {
      AfterCaptureJob: 256 | 2048 | 32,
      AfterUploadJob: 0,
      OverrideScreenshotsFolder: true,
      ScreenshotsFolder: output,
      ImageSettings: { ImageFormat: "PNG", ImageAutoUseJPEG: false },
      GeneralSettings: {
        PlaySoundAfterCapture: false,
        PlaySoundAfterUpload: false,
        PlaySoundAfterAction: false,
        ShowToastNotificationAfterTaskCompleted: false,
      },
      ToolsSettings: {
        UseLegacyImageEditor: true,
        ShowImageEditorSelector: false,
      },
      CaptureSettings: { SurfaceOptions: { AutoCloseEditorOnTask: true } },
      UploadSettings: {
        NameFormatPattern: "%ra{16}",
        NameFormatPatternActiveWindow: "%ra{16}",
      },
      ExternalPrograms: [
        {
          IsActive: true,
          Name: "小羊工作箱入库",
          Path: bridge,
          Args: `receipt "${receipt}" "$input"`,
          HiddenWindow: true,
          Extensions: "png",
        },
      ],
    },
  };
}
export function registerScreenshots(
  app: FastifyInstance,
  options: ScreenshotOptions,
) {
  const { db } = options;
  const root = resolve(options.dataDir, "screenshots");
  const component = resolve(options.dataDir, "components/sharex-21.0.0");
  for (const part of ["originals", "thumbnails", "jobs"])
    mkdirSync(join(root, part), { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS capture_jobs (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), mode TEXT NOT NULL,
    status TEXT NOT NULL, parentId TEXT, pid INTEGER NOT NULL DEFAULT 0, hostPid INTEGER NOT NULL,
    createdAt INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '', imageId TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_capture ON capture_jobs((1)) WHERE ${active};
    CREATE TABLE IF NOT EXISTS screenshots (
    id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), jobId TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL,
    parentId TEXT, deletedAt INTEGER, hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS screenshot_owner_time ON screenshots(userId,createdAt DESC);`);
  if (
    !(
      db.prepare("PRAGMA table_info(screenshots)").all() as { name: string }[]
    ).some((c) => c.name === "fileName")
  )
    db.exec(
      "ALTER TABLE screenshots ADD COLUMN fileName TEXT NOT NULL DEFAULT ''",
    );
  let child: ChildProcess | undefined,
    ownedId: string | undefined,
    closed = false,
    ticking = false;
  let engine: SharexEngine | undefined,
    preparing: Promise<void> | undefined,
    warming: Promise<SharexEngine | undefined> | undefined;
  let sessionValid: (() => boolean) | undefined;
  let engineOwner: string | undefined;
  let engineEpoch = 0;
  const available = () =>
    !!options.source &&
    existsSync(join(options.source, "ShareX.exe")) &&
    !!options.bridge &&
    existsSync(options.bridge);
  const directory = (job: Job) => join(root, "jobs", job.id);
  const original = (id: string) => {
    const name = (
      db.prepare("SELECT fileName FROM screenshots WHERE id=?").get(id) as
        | { fileName: string }
        | undefined
    )?.fileName;
    if (name && basename(name) === name)
      return join(root, "originals", id, name);
    return join(root, "originals", id + ".png");
  };
  const thumb = (id: string) => join(root, "thumbnails", id + ".jpg");
  const getJob = (id: string) =>
    db.prepare("SELECT * FROM capture_jobs WHERE id=?").get(id) as
      | Job
      | undefined;
  const row = (id: string, user: string) =>
    db
      .prepare("SELECT * FROM screenshots WHERE id=? AND userId=?")
      .get(id, user) as Row | undefined;
  async function thumbnail(source: string, target: string) {
    if (options.thumbnail) return options.thumbnail(source, target);
    const { stdout } = await execute(
      options.bridge!,
      ["thumbnail", source, target],
      { windowsHide: true, timeout: 30_000, maxBuffer: 8192 },
    );
    return z
      .object({
        width: z.number().int().min(1),
        height: z.number().int().min(1),
      })
      .parse(JSON.parse(stdout));
  }
  async function importFile(job: Job, path: string) {
    // Accept only finalized PNGs belonging to this issued job; reject links and traversal.
    const expected = await fs.realpath(directory(job));
    const actual = await fs.realpath(path);
    const rel = relative(expected, actual);
    if (
      rel.startsWith("..") ||
      isAbsolute(rel) ||
      !actual.toLowerCase().endsWith(".png")
    )
      throw new Error("截图文件不在任务目录中");
    const info = await fs.stat(actual);
    if (!info.isFile() || info.size < 24 || info.size > 50 * 1024 * 1024)
      throw new Error("截图大小超出限制");
    const bytes = await fs.readFile(actual);
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("截图格式无效");
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 100_000_000)
      throw new Error("截图分辨率超出限制");
    const id = job.id; // One completion per issued job, including reconciliation retries.
    const hash = createHash("sha256").update(bytes).digest("hex");
    const parent = job.parentId ? row(job.parentId, job.userId) : undefined;
    if (
      job.mode === "edit" &&
      actual === join(expected, "input.png") &&
      hash === parent?.hash
    )
      return false;
    await fs.writeFile(original(id) + ".tmp", bytes);
    await fs.rename(original(id) + ".tmp", original(id));
    const dimensions = await thumbnail(original(id), thumb(id) + ".tmp");
    await fs.rename(thumb(id) + ".tmp", thumb(id));
    if (
      closed ||
      !["starting", "running"].includes(getJob(job.id)?.status ?? "")
    )
      return false;
    db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO screenshots (id,userId,jobId,title,category,favorite,createdAt,width,height,bytes,parentId,deletedAt,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        job.userId,
        job.id,
        parent
          ? parent.title + " · 编辑"
          : "截图 " +
              new Date(job.createdAt).toLocaleString("zh-CN", {
                hour12: false,
              }),
        parent?.category ?? "",
        0,
        job.createdAt,
        dimensions.width,
        dimensions.height,
        bytes.length,
        job.parentId,
        null,
        hash,
      );
      db.prepare(
        "UPDATE capture_jobs SET status='complete',imageId=?,error='' WHERE id=?",
      ).run(id, job.id);
    })();
    return true;
  }
  async function reconcile(job: Job, exited: boolean) {
    if (!["starting", "running"].includes(getJob(job.id)?.status ?? "")) return;
    const receipt = join(directory(job), "receipt.json");
    let input: string | undefined;
    if (existsSync(receipt))
      input = z
        .object({ path: z.string().max(4096) })
        .parse(JSON.parse(await fs.readFile(receipt, "utf8"))).path;
    else if (exited) {
      const files = await fs
        .readdir(join(directory(job), "output"))
        .catch(() => [] as string[]);
      const png = files.find((p) => p.toLowerCase().endsWith(".png"));
      if (png) input = join(directory(job), "output", png);
      else if (
        job.mode === "edit" &&
        existsSync(join(directory(job), "input.png"))
      )
        input = join(directory(job), "input.png");
    }
    if (input && (await importFile(job, input))) return;
    if (exited)
      db.prepare(
        "UPDATE capture_jobs SET status='cancelled' WHERE id=? AND " + active,
      ).run(job.id);
  }
  async function tick() {
    if (closed || ticking) return;
    ticking = true;
    try {
      if (sessionValid && !sessionValid()) {
        engineEpoch++;
        const owned = ownedId ? getJob(ownedId) : undefined;
        if (owned && ["starting", "running"].includes(owned.status))
          cancelOwner(owned.userId);
        engine?.close();
        engine = undefined;
        sessionValid = undefined;
        engineOwner = undefined;
      }
      const jobs = db
        .prepare("SELECT * FROM capture_jobs WHERE " + active)
        .all() as Job[];
      for (const job of jobs) {
        // Never interfere with another living host's component or account.
        if (job.hostPid !== process.pid && alive(job.hostPid)) continue;
        const exited =
          !!engine?.completed.has(job.id) ||
          (!alive(job.pid) &&
            (job.status !== "starting" || !alive(job.hostPid)));
        try {
          await reconcile(job, exited);
        } catch (err) {
          if (exited)
            db.prepare(
              "UPDATE capture_jobs SET status='failed',error=? WHERE id=?",
            ).run(err instanceof Error ? err.message : "截图入库失败", job.id);
        }
        if (
          engine?.errors.has(job.id) &&
          getJob(job.id)?.status !== "complete" &&
          getJob(job.id)?.status !== "cancelled"
        )
          db.prepare(
            "UPDATE capture_jobs SET status='failed',error=? WHERE id=?",
          ).run(engine.errors.get(job.id), job.id);
      }
      for (const job of db
        .prepare(
          "SELECT * FROM capture_jobs WHERE status='complete' ORDER BY createdAt DESC LIMIT 10",
        )
        .all() as Job[]) {
        const staging = resolve(directory(job));
        if (
          (!alive(job.pid) || engine?.completed.has(job.id)) &&
          existsSync(staging) &&
          dirname(staging) === resolve(root, "jobs") &&
          uuid.safeParse(job.id).success
        )
          await fs
            .rm(staging, { recursive: true, force: true })
            .catch(() => {});
      }
    } finally {
      ticking = false;
    }
  }
  // Binary files are shared by hard link on the same volume. Config is always
  // private in the workbox data directory; a user's installed ShareX is untouched.
  async function prepareFiles() {
    const marker = join(component, "workbox-component-ready");
    const ready =
      existsSync(marker) &&
      existsSync(join(component, "ShareX.exe")) &&
      (!existsSync(join(options.source!, "ShareX.Workbox.exe")) ||
        existsSync(join(component, "ShareX.Workbox.exe")));
    if (ready) {
      // Refresh our small adapter when the desktop app is rebuilt. The pinned
      // upstream binaries and the private settings do not need copying again.
      for (const name of ["ShareX.Workbox.exe", "ShareX.Workbox.dll", "ShareX.Workbox.runtimeconfig.json", "ShareX.Workbox.deps.json"]) {
        const source = join(options.source!, name), target = join(component, name);
        if (!existsSync(source)) continue;
        const bytes = await fs.readFile(source);
        if (existsSync(target) && bytes.equals(await fs.readFile(target))) continue;
        // Replace the destination link, never overwrite a shared source inode.
        if (existsSync(target)) await fs.unlink(target);
        await fs.writeFile(target, bytes);
      }
      return;
    }
    const copy = async (source: string, target: string) => {
      await fs.mkdir(target, { recursive: true });
      for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        if (entry.name === "ShareX" || entry.isSymbolicLink()) continue;
        const from = join(source, entry.name),
          to = join(target, entry.name);
        if (entry.isDirectory()) await copy(from, to);
        else if (!existsSync(to)) {
          try {
            await fs.link(from, to);
          } catch {
            await fs.copyFile(from, to);
          }
        }
      }
    };
    await copy(options.source!, component);
    await fs.writeFile(marker, "21.0.0");
  }
  function prepare() {
    return (preparing ??= prepareFiles().catch((error) => {
      preparing = undefined;
      throw error;
    }));
  }
  async function warmup(): Promise<SharexEngine | undefined> {
    if (closed || !available() || options.launch) return;
    if (engine?.isReady && !engine.process.killed) return engine;
    if (warming) return warming;
    const epoch = engineEpoch;
    const isCurrent = () => !closed && epoch === engineEpoch && !!engineOwner && !!sessionValid?.();
    warming = (async () => {
      await prepare();
      if (!isCurrent() || !existsSync(join(component, "ShareX.Workbox.exe"))) return;
      // Never start against another live host's private settings.
      const other = db
        .prepare("SELECT hostPid FROM capture_jobs WHERE " + active)
        .get() as { hostPid: number } | undefined;
      if (other && other.hostPid !== process.pid && alive(other.hostPid))
        return;
      await fs.mkdir(join(component, "ShareX"), { recursive: true });
      await fs.writeFile(
        join(component, "ShareX/ApplicationConfig.json"),
        JSON.stringify(
          sharexSettings(
            join(root, "idle"),
            join(root, "idle-receipt.json"),
            options.bridge!,
          ),
        ),
      );
      await fs.writeFile(
        join(component, "ShareX/HotkeysConfig.json"),
        JSON.stringify({ Hotkeys: [] }),
      );
      if (!isCurrent()) return;
      const current = new SharexEngine(join(component, "ShareX.Workbox.exe"), () => {
        if (!closed) void tick();
      });
      engine = current;
      await current.ready;
      if (!isCurrent()) { current.close(); if (engine === current) engine = undefined; return; }
      return current;
    })();
    try {
      return await warming;
    } finally {
      warming = undefined;
    }
  }
  async function start(userId: string, mode: CaptureMode, parentId?: string) {
    await tick();
    if (
      db.prepare("SELECT id FROM capture_jobs WHERE " + active).get() ||
      (child && child.exitCode === null && !child.killed) ||
      engine?.busy
    )
      throw Object.assign(new Error("已有截图任务，请先完成或取消"), {
        statusCode: 409,
      });
    const parent = parentId ? row(parentId, userId) : undefined;
    if (mode === "edit" && (!parent || parent.deletedAt))
      throw Object.assign(new Error("截图不存在"), { statusCode: 404 });
    const id = randomUUID();
    try {
      db.prepare(
        "INSERT INTO capture_jobs (id,userId,mode,status,parentId,hostPid,createdAt) VALUES (?,?,?,'starting',?,?,?)",
      ).run(
        id,
        userId,
        mode,
        mode === "edit" ? parentId : null,
        process.pid,
        Date.now(),
      );
    } catch {
      throw Object.assign(new Error("已有截图任务，请先完成或取消"), {
        statusCode: 409,
      });
    }
    ownedId = id;
    const job = getJob(id)!;
    try {
      await prepare();
      const readyEngine = await warmup();
      const output = join(directory(job), "output");
      await fs.mkdir(output, { recursive: true });
      await fs.mkdir(join(component, "ShareX"), { recursive: true });
      await fs.writeFile(
        join(component, "ShareX/ApplicationConfig.json"),
        JSON.stringify(
          sharexSettings(
            output,
            join(directory(job), "receipt.json"),
            options.bridge!,
          ),
        ),
      );
      await fs.writeFile(
        join(component, "ShareX/HotkeysConfig.json"),
        JSON.stringify({ Hotkeys: [] }),
      );
      const args = ["-portable", "-multi", "-silent", "-autoclose"];
      if (mode === "edit") {
        const input = join(directory(job), "input.png");
        await fs.copyFile(original(parent!.id), input);
        args.push("-ImageEditor", input);
      } else
        args.push(
          mode === "screen"
            ? "-PrintScreen"
            : mode === "window"
              ? "-RectangleLight"
              : "-RectangleRegion",
        );
      if (closed || getJob(id)?.status !== "starting") return getJob(id)!;
      if (readyEngine) {
        db.prepare(
          "UPDATE capture_jobs SET status='running',pid=? WHERE id=?",
        ).run(readyEngine.process.pid!, id);
        await readyEngine.capture({
          id,
          mode,
          settings: join(component, "ShareX/ApplicationConfig.json"),
          ...(mode === "edit"
            ? { input: join(directory(job), "input.png") }
            : {}),
        });
        return getJob(id)!;
      }
      child = options.launch
        ? options.launch(join(component, "ShareX.exe"), args, component)
        : spawn(
            options.bridge!,
            ["run", join(component, "ShareX.exe"), ...args],
            {
              cwd: component,
              stdio: "ignore",
              shell: false,
              windowsHide: true,
            },
          );
      const current = child;
      await new Promise<void>((ok, fail) => {
        current.once("spawn", ok);
        current.once("error", fail);
      });
      db.prepare(
        "UPDATE capture_jobs SET status='running',pid=? WHERE id=?",
      ).run(child.pid!, id);
      child.once("exit", () => {
        if (!closed) void tick();
      });
      return getJob(id)!;
    } catch (err) {
      db.prepare(
        "UPDATE capture_jobs SET status='failed',error=? WHERE id=?",
      ).run("ShareX 启动失败", id);
      throw err;
    }
  }
  function cancelOwner(userId: string) {
    if (!ownedId || getJob(ownedId)?.userId !== userId) return;
    db.prepare(
      "UPDATE capture_jobs SET status='cancelled' WHERE id=? AND " + active,
    ).run(ownedId);
    child?.kill();
    engine?.cancel(ownedId);
  }
  const auth = {
    preHandler: options.authorize as (
      r: FastifyRequest,
      s: FastifyReply,
    ) => Promise<void>,
  };
  // Native video snapshots join the same library without importing arbitrary filesystem paths.
  app.register(async scope => {
    scope.addContentTypeParser("application/octet-stream", {parseAs:"buffer",bodyLimit:50*1024*1024},(_req,body,done)=>done(null,body));
    scope.post("/api/screenshots/video-frame", {...auth,bodyLimit:50*1024*1024}, async(req,reply)=>{
      if(!options.local(req)||!options.nativeFilesToken||req.headers["x-workbox-native-files"]!==options.nativeFilesToken)return reply.code(403).send({error:"仅限本机播放器截帧"});
      const query=z.object({name:z.string().max(160).optional()}).strict().parse(req.query);
      const owner=options.userId(req)!,id=randomUUID(),created=Date.now();
      const bytes=req.body as Buffer;
      if(!Buffer.isBuffer(bytes)||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return reply.code(400).send({error:"截帧必须为 PNG 图片"});
      try{
        const sharp=(await import('sharp')).default;
        const image=sharp(bytes,{limitInputPixels:40_000_000});const meta=await image.metadata();
        if(meta.format!=='png'||!meta.width||!meta.height||(meta.pages??1)!==1)throw Error('image');
        const preview=await image.resize(480,300,{fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
        if(options.userId(req)!==owner)return reply.code(401).send({error:"登录已失效"});
        await fs.writeFile(original(id),bytes,{flag:'wx'});await fs.writeFile(thumb(id),preview,{flag:'wx'});
        db.prepare("INSERT INTO screenshots(id,userId,jobId,title,category,favorite,createdAt,width,height,bytes,parentId,deletedAt,hash) VALUES(?,?,?,?,?,0,?,?,?,?,NULL,NULL,?)").run(id,owner,id,query.name||'视频截帧','视频截帧',created,meta.width,meta.height,bytes.length,createHash('sha256').update(bytes).digest('hex'));
        return {image:publicImage(row(id,owner)!)};
      }catch{
        await Promise.allSettled([fs.unlink(original(id)),fs.unlink(thumb(id))]);
        return reply.code(400).send({error:"截帧无法保存，请检查图片大小和可用空间"});
      }
    });
  });
  app.get("/api/screenshots/status", auth, async (req) => {
    const job = db
      .prepare(
        "SELECT id,status,mode,error,imageId FROM capture_jobs WHERE userId=? ORDER BY createdAt DESC LIMIT 1",
      )
      .get(options.userId(req)!) as Job | undefined;
    return {
      available: options.local(req) && available(),
      version: "21.0.0",
      ready: !!engine?.isReady,
      busy: !!engine?.busy,
      activationMs: job ? engine?.timings.get(job.id) : undefined,
      job: job ?? null,
    };
  });
  app.post("/api/screenshots/warmup", auth, async (req, reply) => {
    if (!options.local(req) || !available())
      return reply.code(503).send({ error: "ShareX 组件未就绪" });
    const owner = options.userId(req)!;
    engineOwner = owner;
    sessionValid = () => options.userId(req) === owner;
    await warmup();
    return { ready: !!engine?.isReady };
  });
  app.post("/api/screenshots/capture", auth, async (req, reply) => {
    if (!options.local(req) || !available())
      return reply
        .code(503)
        .send({ error: "ShareX 组件未就绪，请运行组件准备脚本后重新构建" });
    const data = z
      .object({
        mode: z.enum(["region", "window", "screen", "edit"]),
        parentId: uuid.optional(),
      })
      .parse(req.body);
    const owner = options.userId(req)!;
    engineOwner = owner;
    sessionValid = () => options.userId(req) === owner;
    const job = await start(owner, data.mode, data.parentId);
    return {
      id: job.id,
      status: job.status,
      mode: job.mode,
      error: job.error,
      imageId: job.imageId,
    };
  });
  app.post("/api/screenshots/cancel", auth, async (req) => {
    cancelOwner(options.userId(req)!);
    return { ok: true };
  });
  app.get("/api/screenshots", auth, async (req) => {
    const q = z
      .object({
        view: z.enum(["all", "favorites", "trash"]).default("all"),
        query: z.string().max(100).default(""),
        category: z.string().max(40).default(""),
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      })
      .parse(req.query);
    const where =
      "userId=? AND " +
      (q.view === "trash" ? "deletedAt IS NOT NULL" : "deletedAt IS NULL") +
      (q.view === "favorites" ? " AND favorite=1" : "") +
      " AND instr(lower(title),lower(?))>0" +
      (q.category ? " AND category=?" : "");
    const params: (string | number)[] = [options.userId(req)!, q.query];
    if (q.category) params.push(q.category);
    const images = db
      .prepare(
        "SELECT * FROM screenshots WHERE " +
          where +
          " ORDER BY createdAt DESC,id DESC LIMIT 60 OFFSET ?",
      )
      .all(...params, q.offset) as Row[];
    return {
      images: images.map(publicImage),
      total: (
        db
          .prepare("SELECT count(*) AS n FROM screenshots WHERE " + where)
          .get(...params) as { n: number }
      ).n,
      categories: (
        db
          .prepare(
            "SELECT DISTINCT category FROM screenshots WHERE userId=? AND deletedAt IS NULL AND category!='' ORDER BY category",
          )
          .all(options.userId(req)!) as { category: string }[]
      ).map((x) => x.category),
    };
  });
  app.patch("/api/screenshots", auth, async (req, reply) => {
    const data = z
      .object({
        ids: z.array(uuid).min(1).max(100),
        title: z.string().trim().min(1).max(100).optional(),
        category: z.string().trim().max(40).optional(),
        favorite: z.boolean().optional(),
        trash: z.boolean().optional(),
      })
      .parse(req.body);
    const user = options.userId(req)!;
    if (data.ids.some((id) => !row(id, user)))
      return reply.code(404).send({ error: "截图不存在" });
    const moved: { from: string; to: string }[] = [];
    try {
      db.transaction(() => {
        for (const id of data.ids) {
          const old = row(id, user)!;
          if (data.title && data.title !== old.title) {
            let name =
              data.title
                .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
                .replace(/[. ]+$/g, "")
                .replace(/\.png$/i, "") || "截图";
            if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))
              name = "_" + name;
            name += ".png";
            const from = original(id),
              to = join(root, "originals", id, name);
            if (from !== to) {
              mkdirSync(dirname(to), { recursive: true });
              renameSync(from, to);
              moved.push({ from, to });
            }
            db.prepare(
              "UPDATE screenshots SET fileName=? WHERE id=? AND userId=?",
            ).run(name, id, user);
          }
          db.prepare(
            "UPDATE screenshots SET title=?,category=?,favorite=?,deletedAt=? WHERE id=? AND userId=?",
          ).run(
            data.title ?? old.title,
            data.category ?? old.category,
            data.favorite === undefined ? old.favorite : Number(data.favorite),
            data.trash === undefined
              ? old.deletedAt
              : data.trash
                ? Date.now()
                : null,
            id,
            user,
          );
        }
      })();
    } catch (error) {
      for (const file of moved.reverse()) {
        try {
          renameSync(file.to, file.from);
        } catch {}
      }
      throw error;
    }
    return { ok: true };
  });
  app.get("/api/screenshots/:id/:kind", auth, async (req, reply) => {
    const p = z
      .object({ id: uuid, kind: z.enum(["image", "thumbnail", "native"]) })
      .parse(req.params);
    const image = row(p.id, options.userId(req)!);
    if (!image) return reply.code(404).send({ error: "截图不存在" });
    reply.header("Cache-Control", "no-store");
    if (p.kind === "native") {
      if (!options.local(req))
        return reply.code(403).send({ error: "仅支持本机" });
      return { path: original(p.id), title: image.title };
    }
    const file = p.kind === "image" ? original(p.id) : thumb(p.id);
    if (!existsSync(file))
      return reply.code(404).send({ error: "截图文件已被移动或删除" });
    return reply
      .type(p.kind === "image" ? "image/png" : "image/jpeg")
      .send(createReadStream(file));
  });
  const timer = setInterval(() => void tick(), 750);
  timer.unref();
  app.addHook("onReady", async () => {
    await tick();
  });
  app.addHook("onClose", async () => {
    closed = true;
    engineEpoch++;
    clearInterval(timer);
    child?.kill();
    engine?.close();
    while (ticking) await new Promise((r) => setTimeout(r, 20));
    // Running jobs remain recoverable; startup scans only this workbox's job folders.
  });
  return {
    cancelOwner,
    releaseOwner: (userId: string) => {
      cancelOwner(userId);
      if (engineOwner === userId) {
        engineEpoch++;
        engine?.close();
        engine = undefined;
        engineOwner = undefined;
        sessionValid = undefined;
      }
    },
  };
}
