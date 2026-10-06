import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isIP, connect } from "node:net";
import { Resolver } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { publicSpeedNodes, speedNodes, runSpeed } from "./speed";
import { inspectIdentity, localNetworkInfo } from "./network-info";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NetworkJob, Probe, NetworkIdentity } from "../shared/network";
import { parseNetworkTarget, NETWORK_TARGET_ERROR } from "../shared/network-target";

export function validHost(host: string) {
  return (
    isIP(host) !== 0 ||
    (host.length <= 253 &&
      host
        .split(".")
        .every((p) =>
          /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(p),
        ))
  );
}
export function summarize(samples: Probe[]) {
  const valid = samples
    .filter((s) => s.status === "Success" && s.ms !== null)
    .map((s) => s.ms!);
  const diffs: number[] = [];
  for (let i = 1; i < samples.length; i++)
    if (
      samples[i].ms !== null &&
      samples[i - 1].ms !== null &&
      samples[i].status === "Success" &&
      samples[i - 1].status === "Success"
    )
      diffs.push(Math.abs(samples[i].ms! - samples[i - 1].ms!));
  const mean = (v: number[]) =>
    v.length
      ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2))
      : null;
  return {
    sent: samples.length,
    received: valid.length,
    latencyMs: mean(valid),
    jitterMs: mean(diffs),
    lossPercent: samples.length
      ? Number(
          (((samples.length - valid.length) / samples.length) * 100).toFixed(1),
        )
      : null,
    minMs: valid.length ? Math.min(...valid) : null,
    maxMs: valid.length ? Math.max(...valid) : null,
  };
}
const inputSchema = z
  .object({
    kind: z.enum(["speed", "ping", "dns", "tcp", "trace"]),
    target: z
      .string()
      .transform((value, ctx) => {
        try { return parseNetworkTarget(value); }
        catch { ctx.addIssue({ code: "custom", message: NETWORK_TARGET_ERROR }); return z.NEVER; }
      })
      .refine(value => validHost(value.host), NETWORK_TARGET_ERROR),
    port: z.number().int().min(1).max(65535).default(443),
    // Legacy clients may still send quick/standard; all new runs are timed.
    mode: z.enum(["quick", "standard", "timed"]).default("timed"),
    nodeId: z.enum(["nuaa", "cloudflare"]).default("nuaa"),
  })
  .strict()
  .transform(({ target, port, ...input }) => ({
    ...input,
    target: target.host,
    port: input.kind === "tcp" ? target.port ?? port : port,
  }));
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(t);
      reject(new Error("已取消"));
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      done();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
export function tcpProbe(
  host: string,
  port: number,
  signal: AbortSignal,
): Promise<number> {
  return new Promise((ok, fail) => {
    const start = performance.now();
    signal.throwIfAborted();
    const socket = connect({ host, port });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      socket.destroy();
      error ? fail(error) : ok(Number((performance.now() - start).toFixed(2)));
    };
    const abort = () => finish(new Error("已取消"));
    signal.addEventListener("abort", abort, { once: true });
    socket.setTimeout(2000, () => finish(new Error("连接超时")));
    socket.once("error", () => finish(new Error("连接失败")));
    socket.once("connect", () => finish());
  });
}
async function probeProcess(
  path: string,
  kind: "ping" | "trace",
  target: string,
  signal: AbortSignal,
  onSample: (p: Probe) => void,
) {
  if (!existsSync(path))
    throw new Error("网络探测组件缺失，请重新构建桌面版。");
  await new Promise<void>((ok, fail) => {
    signal.throwIfAborted();
    const child = spawn(path, [kind, target], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WORKBOX_PROBE_PARENT_PID: String(process.pid) },
    });
    let buffer = "";
    let finished = false;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (!child.killed) child.kill();
      err ? fail(err) : ok();
    };
    const abort = () => finish(new Error("已取消"));
    const timer = setTimeout(() => finish(new Error("探测超时")), 30000);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onSample(JSON.parse(line));
        } catch {
          finish(new Error("探测组件返回格式错误"));
        }
      }
    });
    child.stderr.resume();
    child.once("error", () => finish(new Error("无法启动网络探测组件")));
    child.once("exit", (code) =>
      finish(code === 0 ? undefined : new Error("网络探测异常退出")),
    );
  });
}
export interface NetworkOptions {
  db: Database.Database;
  root: string;
  userId: (r: FastifyRequest) => string | undefined;
  authorize: (r: FastifyRequest, p: FastifyReply) => Promise<unknown>;
  local: (r: FastifyRequest) => boolean;
  probePath?: string;
}
export function registerNetwork(app: FastifyInstance, options: NetworkOptions) {
  const { db } = options;
  db.exec(
    "CREATE TABLE IF NOT EXISTS network_reports (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), createdAt INTEGER NOT NULL, data TEXT NOT NULL)",
  );
  const jobs = new Map<
    string,
    {
      job: NetworkJob;
      owner: string;
      controller: AbortController;
      finished: Promise<void>;
    }
  >();
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await options.authorize(req, reply);
    if (reply.sent) return;
    if (!options.local(req))
      return reply.code(403).send({ error: "网络测试仅限 Windows 本机使用。" });
  };
  const probePath=options.probePath ?? resolve(options.root,"../desktop-dev/NetworkProbe.exe");
  const infoControllers=new Set<AbortController>();
  const identityCache=new Map<string,NetworkIdentity>();
  let identifying=false;
  app.get("/api/network/info", { preHandler: guard }, async () => {
    const controller=new AbortController();infoControllers.add(controller);
    try {return {...await localNetworkInfo(probePath,controller.signal),
      interfaces:Object.entries(networkInterfaces()).flatMap(([name,items])=>(items??[]).filter(i=>!i.internal).map(i=>({name,address:i.address,family:i.family}))),
      nodes:publicSpeedNodes(),defaultNode:"nuaa",endpoint:"speed.nuaa.edu.cn",historyLimit:50};
    }finally{infoControllers.delete(controller);}
  });
  app.post("/api/network/identity",{preHandler:guard,config:{rateLimit:{max:8,timeWindow:60000}}},async(req,reply)=>{
    const owner=options.userId(req)!;const cached=identityCache.get(owner);
    if(cached&&Date.now()-cached.checkedAt<10000)return cached;
    if(identifying)return reply.code(409).send({error:"网络信息正在检测，请稍后刷新"});
    if([...jobs.values()].some(j=>j.job.status==="running"))return reply.code(409).send({error:"请在测速结束后检测网络信息"});
    const controller=new AbortController();infoControllers.add(controller);identifying=true;
    const abort=()=>controller.abort();reply.raw.on("close",abort);
    try {
      const local=await localNetworkInfo(probePath,controller.signal);
      const identity=await inspectIdentity(probePath,controller.signal,local);
      if(options.userId(req)!==owner)return reply.code(401).send({error:"登录已失效"});
      identityCache.set(owner,identity);return identity;
    }finally{reply.raw.off("close",abort);infoControllers.delete(controller);identifying=false;}
  });
  app.get("/api/network/history", { preHandler: guard }, async (req) => ({
    reports: (
      db
        .prepare(
          "SELECT data FROM network_reports WHERE owner=? ORDER BY createdAt DESC LIMIT 50",
        )
        .all(options.userId(req)) as { data: string }[]
    ).map((r) => JSON.parse(r.data)),
  }));
  app.post(
    "/api/network/jobs",
    {
      preHandler: guard,
      config: { rateLimit: { max: 20, timeWindow: 60000 } },
    },
    async (req, reply) => {
      const input = inputSchema.parse(req.body);
      const owner = options.userId(req)!;
      if (identifying || [...jobs.values()].some((j) => j.job.status === "running"))
        return reply.code(409).send({ error: "已有测试正在运行。" });
      const job: NetworkJob = {
        id: randomUUID(),
        kind: input.kind,
        status: "running",
        phase: "准备",
        progress: 0,
        startedAt: Date.now(),
        result: {
          target:
            input.kind === "speed" ? speedNodes.find(n=>n.id===input.nodeId)!.host : input.target,
          port: input.kind === "tcp" ? input.port : undefined,
        },
      };
      const controller = new AbortController();
      const signal = controller.signal;
      const run = async () => {
        const sessionTimer = setInterval(() => {
          if (options.userId(req) !== owner) controller.abort();
        }, 500);
        try {
          if (input.kind === "dns") {
            job.phase = "DNS 解析";
            const resolver = new Resolver({ timeout: 2500, tries: 1 });
            const abort = () => resolver.cancel();
            signal.addEventListener("abort", abort, { once: true });
            const start = performance.now();
            try {
              const r = await Promise.allSettled([
                resolver.resolve4(input.target),
                resolver.resolve6(input.target),
              ]);
              signal.throwIfAborted();
              const addresses = r.flatMap((v) =>
                v.status === "fulfilled" ? v.value : [],
              );
              if (!addresses.length)
                throw new Error("DNS 解析失败或无 A / AAAA 记录");
              job.result.addresses = addresses;
              job.result.dnsMs = Number((performance.now() - start).toFixed(2));
            } finally {
              signal.removeEventListener("abort", abort);
            }
          }
          if (input.kind === "tcp") {
            job.phase = "TCP 连接";
            job.result.samples = [];
            for (let i = 0; i < 8; i++) {
              signal.throwIfAborted();
              let ms: number | null = null;
              try {
                ms = await tcpProbe(input.target, input.port, signal);
              } catch {
                signal.throwIfAborted();
              }
              job.result.samples.push({
                index: i + 1,
                address: input.target,
                ms,
                status: ms === null ? "Failed" : "Success",
              });
              Object.assign(job.result, summarize(job.result.samples));
              job.progress = Math.round(((i + 1) / 8) * 100);
              if (i < 7) await pause(200, signal);
            }
          }
          if (input.kind === "ping" || input.kind === "trace") {
            job.phase = input.kind === "ping" ? "ICMP Ping" : "路由追踪";
            job.result.samples = [];
            await probeProcess(
              options.probePath ??
                resolve(options.root, "../desktop-dev/NetworkProbe.exe"),
              input.kind,
              input.target,
              signal,
              (p) => {
                job.result.samples!.push(p);
                job.progress = Math.min(
                  95,
                  Math.round(
                    (p.index / (input.kind === "ping" ? 10 : 20)) * 100,
                  ),
                );
                if (input.kind === "ping")
                  Object.assign(job.result, summarize(job.result.samples!));
              },
            );
            if (input.kind === "trace")
              job.result.reached = job.result.samples.some(
                (s) => s.status === "Success",
              );
          }
          if (input.kind === "speed") {
            await runSpeed(job,speedNodes.find(n=>n.id===input.nodeId)!,signal);
          }
          signal.throwIfAborted();
          job.status = "complete";
          job.phase = "完成";
          job.progress = 100;
        } catch (e) {
          job.status = signal.aborted ? "cancelled" : "failed";
          job.phase = signal.aborted ? "已停止" : "未完成";
          job.error = signal.aborted
            ? undefined
            : e instanceof Error
              ? e.message
              : "测试失败";
        } finally {
          clearInterval(sessionTimer);
          job.finishedAt = Date.now();
          db.prepare("INSERT INTO network_reports VALUES (?,?,?,?)").run(
            job.id,
            owner,
            job.startedAt,
            JSON.stringify(job),
          );
          db.prepare(
            "DELETE FROM network_reports WHERE owner=? AND id NOT IN (SELECT id FROM network_reports WHERE owner=? ORDER BY createdAt DESC LIMIT 50)",
          ).run(owner, owner);
        }
      };
      const entry = { job, owner, controller, finished: Promise.resolve() };
      jobs.set(job.id, entry);
      entry.finished = run();
      for (const [id, j] of jobs)
        if (j.job.status !== "running" && jobs.size > 50) jobs.delete(id);
      return reply.code(202).send({ job });
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/network/jobs/:id",
    { preHandler: guard },
    async (req, reply) => {
      const entry = jobs.get(req.params.id);
      if (!entry || entry.owner !== options.userId(req))
        return reply.code(404).send({ error: "测试记录不存在" });
      return { job: entry.job };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/network/jobs/:id/cancel",
    { preHandler: guard },
    async (req, reply) => {
      const entry = jobs.get(req.params.id);
      if (!entry || entry.owner !== options.userId(req))
        return reply.code(404).send({ error: "测试记录不存在" });
      entry.controller.abort();
      return { ok: true };
    },
  );
  app.addHook("onClose", async () => {
    for(const controller of infoControllers)controller.abort();
    for (const j of jobs.values()) j.controller.abort();
    await Promise.allSettled([...jobs.values()].map((j) => j.finished));
  });
  return {
    cancelOwner: (owner: string) => {
      identityCache.delete(owner);
      for(const controller of infoControllers)controller.abort();
      for (const j of jobs.values())
        if (j.owner === owner && j.job.status === "running")
          j.controller.abort();
    },
  };
}
