import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { AppRuntime } from "../shared/app-runtime";
export type RuntimeEntry = {
  id: string;
  path: string;
  managed: boolean;
  detection?: "process" | "window";
};
const row = z.object({
  id: z.string(),
  state: z.enum(["running", "stopped", "unknown"]),
  instances: z.number().int().nonnegative(),
  since: z.number().nullable(),
  canClose: z.boolean(),
  canShow: z.boolean(),
  accepted: z.boolean(),
});
type Row = z.infer<typeof row>;
export interface RuntimeController {
  list: (
    apps: RuntimeEntry[],
    force?: boolean,
  ) => Promise<Record<string, AppRuntime>>;
  action: (app: RuntimeEntry, action: "show" | "close") => Promise<boolean>;
  starting: (id: string) => void;
  dispose: () => void;
}
export class AppRuntimeController implements RuntimeController {
  private cached: Record<string, AppRuntime> = {};
  private cacheKey = "";
  private sampled = 0;
  private pending: Promise<Record<string, AppRuntime>> | null = null;
  private phases = new Map<
    string,
    { state: "starting" | "closing"; until: number }
  >();
  private children = new Set<ReturnType<typeof spawn>>();
  constructor(private exe: string) {}
  private async probe(apps: RuntimeEntry[], action: "list" | "show" | "close") {
    if (!existsSync(this.exe))
      return apps.map((a) => ({
        id: a.id,
        state: "unknown" as const,
        instances: 0,
        since: null,
        canClose: false,
        canShow: false,
        accepted: false,
      }));
    return new Promise<Row[]>((ok, fail) => {
      const child = spawn(this.exe, [], {
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.children.add(child);
      let output = "",
        error: Error | undefined;
      const timer = setTimeout(() => {
        error = Error("应用状态读取超时");
        child.kill();
      }, 4000);
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (v) => {
        output += v;
        if (output.length > 262144) {
          error = Error("应用状态异常");
          child.kill();
        }
      });
      child.stderr!.resume();
      child.stdin!.on("error", () => {});
      child.stdin!.end(JSON.stringify({ action, apps }));
      child.on("error", () => {
        error = Error("应用管理组件无法启动");
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        this.children.delete(child);
        if (error || code !== 0) {
          fail(error ?? Error("应用管理失败"));
          return;
        }
        try {
          ok(z.array(row).parse(JSON.parse(output.replace(/^\uFEFF/, ""))));
        } catch {
          fail(Error("应用状态无效"));
        }
      });
    });
  }
  async list(apps: RuntimeEntry[], force = false) {
    const key = JSON.stringify(apps);
    if (!force && key === this.cacheKey && Date.now() - this.sampled < 1500)
      return this.cached;
    if (this.pending) {
      await this.pending;
      if (!force && key === this.cacheKey) return this.cached;
    }
    this.pending = (async () => {
      let rows: Row[];
      try {
        rows = await this.probe(apps, "list");
      } catch {
        rows = apps.map((a) => ({
          id: a.id,
          state: "unknown",
          instances: 0,
          since: null,
          canClose: false,
          canShow: false,
          accepted: false,
        }));
      }
      const result: Record<string, AppRuntime> = {};
      for (const r of rows) {
        const phase = this.phases.get(r.id);
        let state: AppRuntime["state"] = r.state;
        if (phase) {
          if (
            Date.now() > phase.until ||
            (phase.state === "starting" && r.state === "running") ||
            (phase.state === "closing" && r.state === "stopped")
          )
            this.phases.delete(r.id);
          else if (r.state !== "unknown") state = phase.state;
        }
        result[r.id] = {
          state,
          instances: r.instances,
          since: r.since,
          canClose: r.canClose,
          canShow: r.canShow,
        };
      }
      this.cached = result;
      this.cacheKey = key;
      this.sampled = Date.now();
      return result;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }
  starting(id: string) {
    this.phases.set(id, { state: "starting", until: Date.now() + 10000 });
    this.sampled = 0;
  }
  async action(app: RuntimeEntry, action: "show" | "close") {
    const result = (await this.probe([app], action))[0];
    this.sampled = 0;
    if (result?.accepted && action === "close")
      this.phases.set(app.id, { state: "closing", until: Date.now() + 15000 });
    return !!result?.accepted;
  }
  dispose() {
    for (const child of this.children) child.kill();
    this.children.clear();
  }
}
