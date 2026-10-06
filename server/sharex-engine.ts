import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname } from "node:path";

export class SharexEngine {
  readonly process: ChildProcessWithoutNullStreams;
  readonly ready: Promise<void>;
  busy = false;
  isReady = false;
  readonly completed = new Set<string>();
  readonly errors = new Map<string, string>();
  readonly timings = new Map<string, number>();
  private activeId?: string;
  constructor(exe: string, onChange: () => void) {
    this.process = spawn(exe, [], {
      cwd: dirname(exe),
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        reject(new Error("ShareX 初始化超时"));
        this.close();
      }, 25_000);
      this.process.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.process.once("exit", () => {
        clearTimeout(timer);
        this.isReady = false;
        if (!settled) reject(new Error("ShareX 未能启动"));
        if (this.activeId) {
          this.errors.set(this.activeId, "截图组件已退出，请重试");
          this.completed.add(this.activeId);
        }
        this.busy = false;
        onChange();
      });
      this.process.stderr.resume();
      createInterface({ input: this.process.stdout }).on("line", (line) => {
        if (process.env.WORKBOX_ENGINE_DEBUG === "1")
          console.error("ShareX adapter:", line);
        if (line.length > 32000) return;
        try {
          const event = JSON.parse(line);
          if (event.type === "ready") {
            clearTimeout(timer);
            settled = true;
            this.isReady = true;
            resolve();
          }
          if (event.type === "fatal") {
            clearTimeout(timer);
            reject(new Error(event.error || "ShareX 启动失败"));
            this.close();
          }
          if (event.id !== this.activeId) return;
          if (event.type === "visible")
            this.timings.set(event.id, Number(event.milliseconds));
          if (event.type === "job-error")
            this.errors.set(event.id, String(event.error));
          if (event.type === "done") {
            this.completed.add(event.id);
            if (this.completed.size > 128) {
              const oldest = this.completed.values().next().value!;
              this.completed.delete(oldest);
              this.errors.delete(oldest);
              this.timings.delete(oldest);
            }
            this.busy = false;
            this.activeId = undefined;
            onChange();
          }
        } catch {}
      });
    });
  }
  async capture(request: {
    id: string;
    mode: string;
    settings: string;
    input?: string;
  }) {
    await this.ready;
    if (this.busy || this.process.exitCode !== null || this.process.killed)
      throw new Error("截图组件正在处理上一张图片，请稍后重试");
    this.activeId = request.id;
    this.busy = true;
    await new Promise<void>((resolve, reject) =>
      this.process.stdin.write(
        JSON.stringify({ type: "capture", ...request }) + "\n",
        (error) => (error ? reject(error) : resolve()),
      ),
    );
  }
  cancel(id: string) {
    if (this.activeId === id)
      this.process.stdin.write(JSON.stringify({ type: "cancel", id }) + "\n");
  }
  close() {
    this.process.kill();
  }
}
