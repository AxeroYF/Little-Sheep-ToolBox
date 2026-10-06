import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { powerSettingsSchema, defaultPowerSettings } from "../shared/power";
import {
  computerSampleSchema,
  computerInfoSchema,
  computerSettingsSchema,
  defaultComputerSettings,
  type ComputerSnapshot,
} from "../shared/computer";

// One sampler per local service, shared by dashboard + overlay. No data is persisted.
export class ComputerSampler {
  private child: ChildProcessWithoutNullStreams | null = null;
  private touched = 0;
  private retryAt = 0;
  private disposed = false;
  private value: ComputerSnapshot = {
    info: null,
    sample: null,
    history: [],
    status: "starting",
    error: null,
  };
  private watchdog: ReturnType<typeof setInterval>;
  constructor(private exe: string) {
    this.watchdog = setInterval(() => {
      if (this.child && Date.now() - this.touched > 6500) this.stop();
      else if (
        this.child &&
        Date.now() - (this.value.sample?.at ?? this.started) > 12000
      ) {
        this.value.error = "采样超时，请重试";
        this.stop();
      }
    }, 1000);
    this.watchdog.unref();
  }
  private started = 0;
  snapshot() {
    this.touched = Date.now();
    if (!this.child && !this.disposed && Date.now() >= this.retryAt)
      this.start();
    return {
      ...this.value,
      status:
        this.value.sample && Date.now() - this.value.sample.at > 4000
          ? "unavailable"
          : this.value.status,
    } as ComputerSnapshot;
  }
  private start() {
    if (!existsSync(this.exe)) {
      this.value = {
        info: null,
        sample: null,
        history: [],
        status: "unavailable",
        error: "未找到本机性能采集组件",
      };
      this.retryAt = Date.now() + 5000;
      return;
    }
    const child = spawn(this.exe, ["--parent", String(process.pid)], {
      cwd: dirname(this.exe),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.started = Date.now();
    this.value = {
      ...this.value,
      sample: null,
      history: [],
      status: "starting",
      error: null,
    };
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (this.child !== child) return;
      buffer += chunk.toString("utf8");
      if (buffer.length > 1024 * 1024) {
        this.value.error = "采样数据异常";
        this.stop();
        return;
      }
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).replace(/^\uFEFF/, "");
        buffer = buffer.slice(i + 1);
        try {
          const item = JSON.parse(line);
          if (item.type === "info")
            this.value.info = computerInfoSchema.parse(item.data);
          else if (item.type === "sample") {
            const sample = computerSampleSchema.parse(item.data);
            this.value = {
              ...this.value,
              sample,
              history: [...this.value.history.slice(-59), sample],
              status: "live",
              error: null,
            };
          }
        } catch {
          this.value.error = "采样数据格式不兼容";
        }
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      if (this.child === child) {
        this.value.status = "unavailable";
        this.value.error = "性能采集组件无法启动";
      }
    });
    child.on("close", () => {
      if (this.child === child) {
        this.child = null;
        this.retryAt = Date.now() + 3000;
        this.value.status = "unavailable";
        this.value.error ??= "性能采集已停止";
      }
    });
  }
  stop() {
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin.end();
      child.kill();
    }
    this.value.sample = null;
    this.value.history = [];
    this.value.status = "starting";
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.watchdog);
    this.stop();
  }
}
export function registerComputer(
  app: FastifyInstance,
  options: {
    db: Database.Database;
    exe: string;
    nativeToken?: string;
    authorize: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    userId: (req: FastifyRequest) => string | undefined;
    local: (req: FastifyRequest) => boolean;
    sampler?: Pick<ComputerSampler, "snapshot" | "dispose">;
  },
) {
  const sampler = options.sampler ?? new ComputerSampler(options.exe),
    viewers = new Map<string, () => boolean>();
  options.db.exec(
    "CREATE TABLE IF NOT EXISTS computer_settings(owner TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  options.db.exec(
    "CREATE TABLE IF NOT EXISTS computer_power_settings(owner TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    await options.authorize(req, reply);
    if (!reply.sent && !options.local(req))
      return reply.code(403).send({ error: "电脑信息仅限本机使用" });
  };
  app.get("/api/computer/snapshot", { preHandler: guard }, async (req) => {
    const id = options.userId(req)!;
    viewers.set(id, () => options.userId(req) === id);
    return sampler.snapshot();
  });
  app.get(
    "/api/computer/power-settings",
    { preHandler: guard },
    async (req) => {
      const row = options.db
        .prepare("SELECT data FROM computer_power_settings WHERE owner=?")
        .get(options.userId(req)) as { data: string } | undefined;
      return row
        ? powerSettingsSchema.parse(JSON.parse(row.data))
        : defaultPowerSettings();
    },
  );
  app.put(
    "/api/computer/power-settings",
    { preHandler: guard },
    async (req) => {
      const setting = powerSettingsSchema.parse(req.body);
      options.db
        .prepare(
          "INSERT INTO computer_power_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data",
        )
        .run(options.userId(req), JSON.stringify(setting));
      return setting;
    },
  );
  app.get("/api/computer/settings", { preHandler: guard }, async (req) => {
    const record = options.db
      .prepare("SELECT data FROM computer_settings WHERE owner=?")
      .get(options.userId(req)) as { data: string } | undefined;
    return record
      ? computerSettingsSchema.parse(JSON.parse(record.data))
      : defaultComputerSettings();
  });
  app.put(
    "/api/computer/settings",
    { preHandler: guard },
    async (req, reply) => {
      if (
        !options.nativeToken ||
        req.headers["x-workbox-native-files"] !== options.nativeToken
      )
        return reply.code(403).send({ error: "请在桌面程序中设置悬浮窗" });
      const settings = computerSettingsSchema.parse(req.body);
      options.db
        .prepare(
          "INSERT INTO computer_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data",
        )
        .run(options.userId(req), JSON.stringify(settings));
      return settings;
    },
  );
  const expiry = setInterval(() => {
    for (const [id, valid] of viewers) if (!valid()) viewers.delete(id);
    if (!viewers.size && sampler instanceof ComputerSampler) sampler.stop();
  }, 1500);
  expiry.unref();
  app.addHook("onClose", async () => {
    clearInterval(expiry);
    sampler.dispose();
  });
  return {
    releaseOwner: (id: string) => {
      viewers.delete(id);
      if (!viewers.size && sampler instanceof ComputerSampler) sampler.stop();
    },
  };
}
