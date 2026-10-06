import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { OcrJob, OcrOptions } from "../shared/ocr";
import { imageEngine, inspectImage } from "./image-engine";

export async function recognizeImage(
  exe: string,
  input: Buffer,
  directory: string,
  options: OcrOptions,
  signal: AbortSignal,
) {
  await inspectImage(input);
  signal.throwIfAborted();
  const path = join(directory, "input.png");
  const sharp = await imageEngine();
  const image = await sharp(input, {
    limitInputPixels: 40_000_000,
    failOn: "error",
  })
    .rotate()
    .resize({
      width: 4000,
      height: 4000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .png()
    .timeout({ seconds: 15 })
    .toFile(path);
  signal.throwIfAborted();
  const text = await new Promise<string>((ok, fail) => {
    const child = spawn(
      exe,
      [
        path,
        "stdout",
        "--tessdata-dir",
        join(dirname(exe), "tessdata"),
        "-l",
        options.language,
        "--psm",
        String({ auto: 3, block: 6, sparse: 11 }[options.layout]),
      ],
      {
        cwd: dirname(exe),
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OMP_THREAD_LIMIT: "2" },
      },
    );
    let output = "",
      failure: Error | undefined;
    const abort = () => {
      failure = Error("识别已取消");
      child.kill();
    };
    const timeout = setTimeout(() => {
      failure = Error("识别超时，请裁切图片后重试");
      child.kill();
    }, 30000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1_000_000) {
        failure = Error("识别结果过长，请分区识别");
        child.kill();
      }
    });
    child.stderr.resume();
    child.on("error", () => {
      failure = Error("OCR 组件无法启动");
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (failure) fail(failure);
      else if (code !== 0) fail(Error("识别失败，请检查图片或语言组件"));
      else ok(output.trim());
    });
  });
  return { text, width: image.width, height: image.height };
}
export function registerOcr(
  app: FastifyInstance,
  options: {
    exe: string;
    dataDir: string;
    authorize: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    userId: (req: FastifyRequest) => string | undefined;
    local: (req: FastifyRequest) => boolean;
  },
) {
  type State = {
    job: OcrJob;
    controller: AbortController;
    pending: Promise<void>;
    valid: () => boolean;
  };
  const states = new Map<string, State>(),
    base = resolve(options.dataDir, "ocr-temp");
  const ready = (async () => {
    await mkdir(base, { recursive: true });
    for (const d of await readdir(base, { withFileTypes: true })) {
      const m = /^session-(\d+)-[A-Za-z0-9]+$/.exec(d.name);
      if (!m || !d.isDirectory() || d.isSymbolicLink()) continue;
      try {
        process.kill(Number(m[1]), 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH")
          await rm(join(base, d.name), { recursive: true, force: true });
      }
    }
  })();
  void ready.catch(() => {});
  const available = () =>
    existsSync(options.exe) &&
    ["eng", "chi_sim", "osd"].every((n) =>
      existsSync(join(dirname(options.exe), "tessdata", n + ".traineddata")),
    );
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await options.authorize(req, reply);
    if (!reply.sent && !options.local(req))
      return reply.code(403).send({ error: "文字识别仅限本机使用" });
  };
  const releaseOwner = async (id: string) => {
    const s = states.get(id);
    if (!s) return;
    states.delete(id);
    s.controller.abort();
    await s.pending;
  };
  const timer = setInterval(() => {
    for (const [id, s] of states) if (!s.valid()) void releaseOwner(id);
  }, 1000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await ready.catch(() => {});
    await Promise.all([...states.keys()].map(releaseOwner));
  });
  app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: 50 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
    scope.get("/api/ocr/status", { preHandler: guard }, async (req) => ({
      available: available(),
      job: states.get(options.userId(req)!)?.job ?? null,
    }));
    scope.post(
      "/api/ocr/recognize",
      { preHandler: guard, bodyLimit: 50 * 1024 * 1024 },
      async (req, reply) => {
        const input = z
          .object({
            id: z.string().uuid(),
            language: z.enum(["chi_sim+eng", "chi_sim", "eng"]),
            layout: z.enum(["auto", "block", "sparse"]),
          })
          .strict()
          .parse(req.query);
        if (!available())
          return reply
            .code(503)
            .send({ error: "文字识别组件未就绪，请更新工作箱" });
        if (!Buffer.isBuffer(req.body) || !req.body.length)
          return reply.code(400).send({ error: "请选择图片" });
        const owner = options.userId(req)!;
        if (states.get(owner)?.job.status === "running")
          return reply.code(409).send({ error: "已有文字识别任务正在运行" });
        await ready;
        // Never accept paths or URLs: only bounded image bytes from the signed-in app.
        if (options.userId(req) !== owner)
          return reply.code(401).send({ error: "请重新登录" });
        if (states.get(owner)?.job.status === "running")
          return reply.code(409).send({ error: "已有文字识别任务正在运行" });
        const body = req.body,
          controller = new AbortController(),
          started = Date.now();
        const job: OcrJob = {
          id: input.id,
          status: "running",
          text: "",
          error: null,
          elapsedMs: 0,
        };
        const s: State = {
          job,
          controller,
          pending: Promise.resolve(),
          valid: () => options.userId(req) === owner,
        };
        states.set(owner, s);
        s.pending = (async () => {
          let dir: string | undefined;
          try {
            dir = await mkdtemp(join(base, `session-${process.pid}-`));
            controller.signal.throwIfAborted();
            const result = await recognizeImage(
              options.exe,
              body,
              dir,
              input,
              controller.signal,
            );
            controller.signal.throwIfAborted();
            if (!s.valid()) throw Error("登录已失效");
            Object.assign(job, result);
            job.status = "complete";
          } catch (e) {
            job.status = controller.signal.aborted ? "cancelled" : "failed";
            job.error =
              job.status === "cancelled"
                ? null
                : e instanceof Error &&
                    /识别|图片|像素|不支持|单页/.test(e.message)
                  ? e.message
                  : "无法识别这张图片";
          } finally {
            if (dir)
              await rm(dir, { recursive: true, force: true }).catch(() => {
                job.status = "failed";
                job.error = "临时图片清理失败，请重新打开工作箱";
              });
            job.elapsedMs = Date.now() - started;
          }
        })();
        return reply.code(202).send(job);
      },
    );
    scope.post<{ Params: { id: string } }>(
      "/api/ocr/:id/cancel",
      { preHandler: guard },
      async (req, reply) => {
        const s = states.get(options.userId(req)!);
        if (!s || s.job.id !== req.params.id)
          return reply.code(404).send({ error: "识别任务不存在" });
        s.controller.abort();
        await s.pending;
        return s.job;
      },
    );
  });
  return { releaseOwner };
}
