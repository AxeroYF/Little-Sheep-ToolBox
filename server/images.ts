import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IMAGE_BATCH_LIMIT, IMAGE_FILE_LIMIT, imageSettingsSchema, type ImageJob, type ImageWorkshopState, type WorkshopImage } from "../shared/images";
import { convertImage, imageThumbnail, inspectImage, publishImage } from "./image-engine";

type Input = { info: WorkshopImage; source: string; preview: string };
type State = { images: Map<string, Input>; directory: string; scratch?: string; job: ImageJob | null;
  results: Map<string, string>; controller?: AbortController; pending: Set<Promise<unknown>>; closed: boolean; importing: boolean; valid: () => boolean };
export function registerImages(app: FastifyInstance, options: {
  dataDir: string; nativeFilesToken?: string;
  authorize: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  userId: (req: FastifyRequest) => string | undefined; local: (req: FastifyRequest) => boolean;
}) {
  const states = new Map<string, State>();
  const base = resolve(options.dataDir, "image-workshop-temp"), defaultOutput = resolve(options.dataDir, "图片工坊导出");
  // Only reclaim our own session directories after their service has exited.
  const cleanup = (async () => {
    await mkdir(base, { recursive: true });
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const match = /^session-(\d+)-[A-Za-z0-9]+$/.exec(entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink() || !match) continue;
      try { process.kill(Number(match[1]), 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") await rm(join(base, entry.name), { recursive: true, force: true }); }
    }
  })().catch(error => app.log.warn({ err: error }, "Image temporary directory cleanup failed"));
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await options.authorize(req, reply); if (reply.sent) return;
    if (!options.local(req)) return reply.code(403).send({ error: "图片工坊仅限本机使用" });
  };
  const nativeGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    await guard(req, reply); if (reply.sent) return;
    if (!options.nativeFilesToken || req.headers["x-workbox-native-files"] !== options.nativeFilesToken)
      return reply.code(403).send({ error: "请通过本机文件夹选择器操作" });
  };
  function state(req: FastifyRequest) {
    const owner = options.userId(req)!;
    let s = states.get(owner);
    if (!s) { s = { images: new Map(), directory: defaultOutput, job: null, results: new Map(), pending: new Set(), closed: false, importing: false, valid: () => true }; states.set(owner, s); }
    s.valid = () => options.userId(req) === owner;
    return s;
  }
  const snapshot = (s: State): ImageWorkshopState => ({ images: [...s.images.values()].map(i => i.info), job: s.job, outputDirectory: s.directory });
  async function scratch(s: State) {
    if (!s.scratch) { await cleanup; await mkdir(base, { recursive: true }); s.scratch = await mkdtemp(join(base, `session-${process.pid}-`)); }
    return s.scratch;
  }
  function live(s: State) { if (s.closed || !s.valid()) throw new Error("操作已取消"); }
  async function release(owner: string) {
    const s = states.get(owner); if (!s) return;
    states.delete(owner); s.closed = true; s.controller?.abort();
    await Promise.allSettled([...s.pending]);
    if (s.scratch && resolve(s.scratch).startsWith(base + (process.platform === "win32" ? "\\" : "/"))) await rm(s.scratch, { recursive: true, force: true });
  }
  const timer = setInterval(() => { for (const [owner, s] of states) if (!s.valid()) void release(owner).catch(error => app.log.warn({ err: error }, "Image temporary cleanup failed")); }, 1000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); await Promise.allSettled([...states.keys()].map(release)); });
  app.register(async scope => {
    scope.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: IMAGE_FILE_LIMIT }, (_req, body, done) => done(null, body));
    scope.get("/api/images", { preHandler: guard }, async req => snapshot(state(req)));
    scope.post<{ Querystring: { name: string } }>("/api/images/import", { preHandler: guard, bodyLimit: IMAGE_FILE_LIMIT }, async (req, reply) => {
      const s = state(req); if (s.importing || s.job?.status === "running") return reply.code(409).send({ error: "请等待当前任务结束" });
      if (s.images.size >= IMAGE_BATCH_LIMIT) return reply.code(400).send({ error: "一次最多添加 50 张图片" });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: "图片为空" });
      if ([...s.images.values()].reduce((n, i) => n + i.info.bytes, 0) + req.body.length > 250 * 1024 * 1024)
        return reply.code(400).send({ error: "当前批次不能超过 250 MB" });
      const name = basename(z.string().min(1).max(240).parse(req.query.name).replace(/\\/g, "/"));
      const data = req.body, id = randomUUID(); s.importing = true;
      const operation = (async () => {
        let source: string | undefined, preview: string | undefined;
        try {
          const metadata = await inspectImage(data); live(s);
          const dir = await scratch(s); source = join(dir, id + ".input"); preview = join(dir, id + ".png");
          await writeFile(source, data, { flag: "wx" }); await imageThumbnail(data, preview); live(s);
          const info: WorkshopImage = { id, name, bytes: data.length, ...metadata };
          s.images.set(id, { info, source, preview }); return { image: info };
        } catch (error) {
          await Promise.allSettled([source, preview].filter((v): v is string => !!v).map(file => rm(file, { force: true })));
          const reason = error instanceof Error ? error.message : "无法读取图片";
          return reply.code(400).send({ error: /首版|不支持|像素|取消/.test(reason) ? reason : "图片格式不支持、文件损坏或尺寸过大" });
        } finally { s.importing = false; }
      })(); s.pending.add(operation); try { return await operation; } finally { s.pending.delete(operation); }
    });
    scope.delete("/api/images", { preHandler: guard }, async req => { const directory = state(req).directory; await release(options.userId(req)!); state(req).directory = directory; return { ok: true }; });
    scope.delete<{ Params: { id: string } }>("/api/images/:id", { preHandler: guard }, async (req, reply) => {
      const s = state(req); if (s.importing || s.job?.status === "running") return reply.code(409).send({ error: "请等待当前任务结束" });
      const item = s.images.get(req.params.id); if (!item) return reply.code(404).send({ error: "图片不存在" });
      s.images.delete(req.params.id); await Promise.all([rm(item.source, { force: true }), rm(item.preview, { force: true })]); return snapshot(s);
    });
    scope.get<{ Params: { id: string } }>("/api/images/:id/preview", { preHandler: guard }, async (req, reply) => {
      const item = state(req).images.get(req.params.id); if (!item) return reply.code(404).send({ error: "图片不存在" });
      return reply.type("image/png").send(await readFile(item.preview));
    });
    scope.get<{Params:{id:string}}>("/api/images/:id/ocr-input", {preHandler:guard}, async(req,reply)=>{
      const item=state(req).images.get(req.params.id);if(!item)return reply.code(404).send({error:'图片不存在'});
      return reply.type('application/octet-stream').send(await readFile(item.source));
    });
    scope.post("/api/images/output", { preHandler: nativeGuard }, async (req, reply) => {
      const s = state(req); if (s.job?.status === "running") return reply.code(409).send({ error: "转换中无法更换目录" });
      const { path } = z.object({ path: z.string().min(1).max(1024) }).strict().parse(req.body);
      if (!isAbsolute(path)) return reply.code(400).send({ error: "请选择有效文件夹" });
      const directory = await realpath(path); if (!(await stat(directory)).isDirectory()) return reply.code(400).send({ error: "请选择文件夹" });
      live(s); if (snapshot(s).job?.status === "running") return reply.code(409).send({ error: "转换中无法更换目录" });
      s.directory = directory; return snapshot(s);
    });
    scope.get<{ Querystring: { job?: string; image?: string } }>("/api/images/reveal", { preHandler: nativeGuard }, async (req, reply) => {
      const s = state(req);
      if (req.query.image) {
        if (req.query.job !== s.job?.id || !s.results.has(req.query.image)) return reply.code(404).send({ error: "转换结果不存在" });
        return { path: s.results.get(req.query.image), folder: false };
      }
      const path = req.query.job === s.job?.id ? s.job!.outputDirectory : s.directory;
      await mkdir(path, { recursive: true }); return { path, folder: true };
    });
    scope.get<{ Params: { id: string; image: string } }>("/api/images/jobs/:id/:image/download", { preHandler: guard }, async (req, reply) => {
      const s = state(req), path = s.results.get(req.params.image);
      if (s.job?.id !== req.params.id || !path) return reply.code(404).send({ error: "转换结果不存在" });
      return reply.header("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(basename(path))).type("application/octet-stream").send(await readFile(path));
    });
    scope.post("/api/images/convert", { preHandler: guard }, async (req, reply) => {
      const input = z.object({ ids: z.array(z.string().uuid()).min(1).max(IMAGE_BATCH_LIMIT), settings: imageSettingsSchema }).strict().parse(req.body);
      const s = state(req); if (s.importing || s.job?.status === "running") return reply.code(409).send({ error: "已有转换任务正在运行" });
      if (new Set(input.ids).size !== input.ids.length || input.ids.some(id => !s.images.has(id))) return reply.code(400).send({ error: "请选择已添加的图片" });
      const job: ImageJob = { id: randomUUID(), status: "running", settings: input.settings, outputDirectory: s.directory,
        items: input.ids.map(imageId => ({ imageId, name: s.images.get(imageId)!.info.name, status: "queued" })) };
      s.job = job; s.results.clear(); s.controller = new AbortController(); const signal = s.controller.signal;
      const operation = (async () => {
        try {
          await mkdir(job.outputDirectory, { recursive: true }); live(s);
          for (const item of job.items) {
            if (signal.aborted || s.closed || !s.valid()) { item.status = "cancelled"; continue; }
            item.status = "running"; const temp = join(await scratch(s), randomUUID() + ".output");
            try {
              await convertImage(s.images.get(item.imageId)!.source, temp, job.settings, signal); live(s); signal.throwIfAborted();
              const result = await publishImage(temp, job.outputDirectory, item.name, job.settings.format);
              if (signal.aborted || s.closed || !s.valid()) { await rm(result.path, { force: true }); signal.throwIfAborted(); live(s); }
              s.results.set(item.imageId, result.path); item.outputName = result.outputName; item.outputBytes = result.outputBytes; item.status = "complete";
            } catch (error) {
              item.status = signal.aborted || s.closed || !s.valid() ? "cancelled" : "failed";
              if (item.status === "failed") item.error = /EACCES|EPERM/.test(String(error)) ? "输出目录不可写" : "转换失败，请检查图片或更换格式";
            } finally { await rm(temp, { force: true }); }
          }
          const completed = job.items.filter(i => i.status === "complete").length;
          job.status = job.items.some(i => i.status === "cancelled") ? "cancelled" : completed === job.items.length ? "complete" : completed ? "partial" : "failed";
        } catch { job.status = "failed"; for (const item of job.items) if (item.status === "queued" || item.status === "running") { item.status = "failed"; item.error = "转换任务中断"; } }
      })(); s.pending.add(operation); void operation.finally(() => s.pending.delete(operation));
      return reply.code(202).send({ job });
    });
    scope.post("/api/images/cancel", { preHandler: guard }, async req => { const s = state(req); s.controller?.abort(); return { ok: true }; });
  });
  return { releaseOwner: release };
}
