import { useEffect, useRef, useState } from "react";
import {
  Cpu,
  MemoryStick,
  Monitor,
  HardDrive,
  ArrowDown,
  ArrowUp,
  Pause,
  Play,
  SlidersHorizontal,
  PanelsTopLeft,
  Eye,
  EyeOff,
  Zap,
} from "lucide-react";
import { api } from "./api";
import { nativeMessage } from "./App";
import { captureHotkeyFromEvent, displayHotkey } from "../shared/hotkey";
import {
  defaultComputerSettings,
  selectedNetwork,
  type ComputerSettings,
  type ComputerSnapshot,
} from "../shared/computer";
import "./computer.css";
import ComputerDetails, { type HardwarePage } from "./ComputerDetails";
import ComputerPower from "./ComputerPower";
import {
  defaultPowerSettings,
  estimatePower,
  type PowerSettings,
} from "../shared/power";
const empty: ComputerSnapshot = {
  info: null,
  sample: null,
  history: [],
  status: "starting",
  error: null,
};
const number = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : n.toFixed(d);
const gib = (n: number | null | undefined) =>
  n == null ? "—" : (n / 1073741824).toFixed(1);
const speed = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n >= 1048576
      ? (n / 1048576).toFixed(1) + " MB/s"
      : (n / 1024).toFixed(1) + " KB/s";
export function Spark({
  values,
  color = "#1483ff",
  percent = false,
  label,
}: {
  values: (number | null)[];
  color?: string;
  percent?: boolean;
  label: string;
}) {
  const max = percent ? 100 : Math.max(1, ...values.map((v) => v ?? 0));
  const segments: string[] = [];
  let line = "";
  values.forEach((v, i) => {
    if (v == null) {
      if (line) segments.push(line);
      line = "";
      return;
    }
    line +=
      (line ? " L" : "M") +
      ((i / Math.max(1, values.length - 1)) * 360).toFixed(2) +
      " " +
      (76 - Math.min(1, v / max) * 68).toFixed(2);
  });
  if (line) segments.push(line);
  return (
    <svg
      className="computer-spark"
      viewBox="0 0 360 82"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d="M0 8H360 M0 42H360 M0 76H360" className="computer-grid" />
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
function Gauge({
  value,
  color = "#1483ff",
}: {
  value: number | null | undefined;
  color?: string;
}) {
  return (
    <svg className="computer-gauge" viewBox="0 0 80 80" aria-hidden="true">
      <circle
        cx="40"
        cy="40"
        r="32"
        fill="none"
        stroke="var(--line)"
        strokeWidth="5"
      />
      <circle
        cx="40"
        cy="40"
        r="32"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        transform="rotate(-90 40 40)"
        strokeDasharray={`${Math.max(0, Math.min(100, value ?? 0)) * 2.0106} 201.06`}
      />
    </svg>
  );
}
export default function ComputerPanel() {
  const [snapshot, setSnapshot] = useState(empty),
    [paused, setPaused] = useState(false),
    [tab, setTab] = useState<"dashboard" | "details" | "power" | "settings">(
      "dashboard",
    ),
    [hardwarePage, setHardwarePage] = useState<HardwarePage>("cpu"),
    [networkId, setNetworkId] = useState("auto"),
    [hostVisible, setHostVisible] = useState(true),
    [documentVisible, setDocumentVisible] = useState(!document.hidden);
  const [powerSettings, setPowerSettings] =
      useState<PowerSettings>(defaultPowerSettings),
    [powerReady, setPowerReady] = useState(false);
  const [settings, setSettings] = useState<ComputerSettings>(
      defaultComputerSettings,
    ),
    [draft, setDraft] = useState<ComputerSettings>(defaultComputerSettings),
    [overlay, setOverlay] = useState(false),
    [available, setAvailable] = useState(true),
    [recording, setRecording] = useState(false),
    [saving, setSaving] = useState(false),
    [settingsReady, setSettingsReady] = useState(false),
    [error, setError] = useState("");
  const native = !!(window as any).workboxNative,
    recorder = useRef<HTMLButtonElement>(null),
    pending = useRef<{
      id: string;
      timer: ReturnType<typeof setTimeout>;
    } | null>(null);
  useEffect(() => {
    void api<PowerSettings>("/computer/power-settings")
      .then((s) => {
        setPowerSettings(s);
        setPowerReady(true);
      })
      .catch((e) => setError(e.message));
    void api<ComputerSettings>("/computer/settings")
      .then((s) => {
        setSettings(s);
        setDraft(s);
        setSettingsReady(true);
      })
      .catch((e) => setError(e.message));
    const bridge = (window as any).chrome?.webview;
    const receive = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === "computer-visibility") setHostVisible(!!m.visible);
      if (m?.type === "computer-state") {
        setOverlay(!!m.visible);
        setAvailable(!!m.available);
        if (m.settings) setSettings(m.settings);
      }
      if (m?.type === "computer-recording-cancelled") setRecording(false);
      if (
        m?.type === "computer-saved" &&
        pending.current &&
        pending.current.id === m.requestId
      ) {
        clearTimeout(pending.current.timer);
        pending.current = null;
        setSaving(false);
        setRecording(false);
        if (m.error) setError(m.error);
        else {
          setSettings(m.settings);
          setDraft(m.settings);
          setError("");
        }
      }
    };
    bridge?.addEventListener("message", receive);
    nativeMessage({ action: "computer-sync" });
    const visible = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", visible);
    return () => {
      bridge?.removeEventListener("message", receive);
      document.removeEventListener("visibilitychange", visible);
      if (pending.current) clearTimeout(pending.current.timer);
      nativeMessage({ action: "computer-recording", active: false });
    };
  }, []);
  useEffect(() => {
    nativeMessage({ action: "computer-recording", active: recording });
    if (recording) recorder.current?.focus();
  }, [recording]);
  useEffect(() => {
    if (paused || !hostVisible || !documentVisible || tab === "settings")
      return;
    let live = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await api<ComputerSnapshot>("/computer/snapshot", {
          signal: controller.signal,
        });
        if (live) setSnapshot(next);
      } catch (e) {
        if (live)
          setSnapshot((s) => ({
            ...s,
            status: "unavailable",
            error: e instanceof Error ? e.message : "采样失败",
          }));
      }
      if (live) timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [paused, hostVisible, documentVisible, tab]);
  function save() {
    if (saving) return;
    setError("");
    const id = crypto.randomUUID();
    setSaving(true);
    pending.current = {
      id,
      timer: setTimeout(() => {
        pending.current = null;
        setSaving(false);
        setRecording(false);
        setError("保存超时，请重新打开设置确认");
      }, 15000),
    };
    nativeMessage({ action: "computer-save", settings: draft, requestId: id });
  }
  const live = snapshot.status === "live",
    sample = live ? snapshot.sample : null,
    info = snapshot.info,
    network = selectedNetwork(sample, networkId),
    memory =
      sample?.memoryTotal && sample.memoryUsed != null
        ? (100 * sample.memoryUsed) / sample.memoryTotal
        : null,
    gpu = sample?.gpus[0],
    gpuNames = [
      ...new Set([
        ...(info?.gpus ?? []),
        ...(sample?.gpus.map((g) => g.name) ?? []),
      ]),
    ];
  const history = snapshot.history,
    seconds = sample?.uptimeSeconds ?? 0;
  const power = powerReady ? estimatePower(sample, powerSettings) : null;
  const cards = [
    {
      key: "cpu",
      title: "CPU",
      Icon: Cpu,
      value: sample?.cpu,
      detail: sample?.cpuMhz
        ? `${(sample.cpuMhz / 1000).toFixed(2)} GHz · ${info?.logicalProcessors ?? "—"} 线程`
        : "总处理器占用",
      color: "#1483ff",
      values: history.map((s) => s.cpu),
    },
    {
      key: "memory",
      title: "内存",
      Icon: MemoryStick,
      value: memory,
      detail: `${gib(sample?.memoryUsed)} / ${gib(sample?.memoryTotal)} GB`,
      color: "#a083ff",
      values: history.map((s) =>
        s.memoryTotal && s.memoryUsed != null
          ? (100 * s.memoryUsed) / s.memoryTotal
          : null,
      ),
    },
    {
      key: "gpu",
      title: "GPU",
      Icon: Monitor,
      value: sample?.gpu,
      detail:
        gpu?.temperature != null
          ? `${gpu.temperature} °C · 显存 ${gib(gpu.memoryUsed)} / ${gib(gpu.memoryTotal)} GB`
          : `专用显存 ${gib(sample?.gpuMemoryUsed)} GB`,
      color: "#2ac59b",
      values: history.map((s) => s.gpu),
    },
    {
      key: "power",
      title: "整机估算",
      Icon: Zap,
      value: power?.ac,
      detail: power
        ? `约 ${Math.round(power.low)}–${Math.round(power.high)} W · 插座侧`
        : "等待读数",
      color: "#edab3c",
      values: powerReady
        ? history.map((s) => estimatePower(s, powerSettings)?.ac ?? null)
        : [],
    },
  ];
  return (
    <section className="computer-app" aria-label="电脑信息仪表盘">
      <div className="computer-toolbar">
        <div className="computer-tabs">
          <button
            aria-pressed={tab === "dashboard"}
            onClick={() => {
              setRecording(false);
              setTab("dashboard");
            }}
          >
            <PanelsTopLeft size={15} />
            仪表盘
          </button>
          <button
            aria-pressed={tab === "details"}
            onClick={() => {
              setRecording(false);
              setTab("details");
            }}
          >
            <Cpu size={15} />
            硬件详情
          </button>
          <button
            aria-pressed={tab === "power"}
            onClick={() => {
              setRecording(false);
              setTab("power");
            }}
          >
            <Zap size={15} />
            功率估算
          </button>
          <button
            aria-pressed={tab === "settings"}
            onClick={() => {
              setDraft(settings);
              setTab("settings");
            }}
          >
            <SlidersHorizontal size={15} />
            悬浮窗
          </button>
        </div>
        <span
          className={
            "computer-live " +
            (live && (!paused || overlay) && (tab !== "settings" || overlay)
              ? "live"
              : "")
          }
        >
          {tab === "settings" && !overlay
            ? "按需采样"
            : paused && !overlay
              ? "已暂停"
              : snapshot.status === "starting"
                ? "正在采样"
                : live
                  ? "实时 · 1 秒"
                  : "采样不可用"}
        </span>
        {tab !== "settings" && (
          <button className="secondary" onClick={() => setPaused((v) => !v)}>
            {paused ? <Play size={14} /> : <Pause size={14} />}{" "}
            {paused ? "继续" : "暂停"}
          </button>
        )}
        <button
          className="primary"
          disabled={!native || saving || recording}
          onClick={() => nativeMessage({ action: "computer-toggle" })}
        >
          {overlay ? <EyeOff size={15} /> : <Eye size={15} />}{" "}
          {overlay ? "隐藏悬浮窗" : "显示悬浮窗"}
        </button>
      </div>
      {error && (
        <div className="computer-error" role="alert">
          {error}
        </div>
      )}
      {tab === "dashboard" ? (
        <>
          <div className="computer-device">
            <div>
              <strong>{info?.cpu ?? "读取设备信息…"}</strong>
              <span>{gpuNames.join(" · ") || "GPU 信息待采样"}</span>
            </div>
            <div>
              <span>{info?.os ?? "Windows"}</span>
              <small>
                已运行 {Math.floor(seconds / 86400)} 天{" "}
                {Math.floor((seconds % 86400) / 3600)} 小时
              </small>
            </div>
          </div>
          {snapshot.error && (
            <div className="computer-error" role="status">
              {snapshot.error}
            </div>
          )}
          <div className="computer-cards">
            {cards.map((c) => (
              <article
                className="computer-card"
                key={c.key}
                aria-label={c.title + " 性能"}
              >
                <div className="computer-card-title">
                  <c.Icon size={16} />
                  <span>{c.title}</span>
                  <small>最近 60 秒</small>
                  <button
                    className="hardware-detail-button"
                    aria-label={"查看" + c.title + "详情"}
                    onClick={() => {
                      if (c.key === "power") setTab("power");
                      else {
                        setHardwarePage(c.key as HardwarePage);
                        setTab("details");
                      }
                    }}
                  >
                    详情
                  </button>
                </div>
                <div className="computer-reading">
                  <div>
                    <strong>
                      {c.key === "power" && c.value != null ? "≈ " : ""}
                      {number(c.value)}
                      <small>{c.key === "power" ? "W" : "%"}</small>
                    </strong>
                    <span>{c.detail}</span>
                  </div>
                  {c.key !== "power" && (
                    <Gauge value={c.value} color={c.color} />
                  )}
                </div>
                <Spark
                  values={c.values}
                  color={c.color}
                  percent={c.key !== "power"}
                  label={c.title + " 占用曲线"}
                />
              </article>
            ))}
          </div>
          <div className="computer-bottom">
            <article className="computer-panel">
              <div className="computer-panel-title">
                <span>网络</span>
                <select
                  aria-label="监测网卡"
                  value={networkId}
                  onChange={(e) => setNetworkId(e.target.value)}
                >
                  <option value="auto">自动 · 最活跃物理网卡</option>
                  {sample?.networks.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                      {n.virtual ? " · 虚拟" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <small>
                {network?.name ?? "等待网卡采样"}
                {network?.virtual ? " · 虚拟网卡" : ""}
              </small>
              <div className="computer-dual">
                <div>
                  <span>
                    <ArrowDown size={13} />
                    接收
                  </span>
                  <strong>{speed(network?.receive)}</strong>
                  <Spark
                    label="网卡接收速率曲线"
                    values={history.map(
                      (s) => selectedNetwork(s, networkId)?.receive ?? null,
                    )}
                  />
                </div>
                <div>
                  <span>
                    <ArrowUp size={13} />
                    发送
                  </span>
                  <strong>{speed(network?.send)}</strong>
                  <Spark
                    label="网卡发送速率曲线"
                    color="#a083ff"
                    values={history.map(
                      (s) => selectedNetwork(s, networkId)?.send ?? null,
                    )}
                  />
                </div>
              </div>
            </article>
            <article className="computer-panel">
              <div className="computer-panel-title">
                <span>磁盘</span>
                <button
                  className="hardware-detail-button"
                  onClick={() => {
                    setHardwarePage("disk");
                    setTab("details");
                  }}
                >
                  磁盘详情
                </button>
              </div>
              <div className="computer-disk-rate">
                <span>
                  读取 <strong>{speed(sample?.diskRead)}</strong>
                </span>
                <span>
                  写入 <strong>{speed(sample?.diskWrite)}</strong>
                </span>
              </div>
              <div className="computer-drives">
                {info?.drives.map((d) => (
                  <div key={d.name}>
                    <HardDrive size={15} />
                    <b>{d.name}</b>
                    <progress
                      aria-label={d.name + " 已用容量"}
                      max={d.total ?? 1}
                      value={d.total && d.free != null ? d.total - d.free : 0}
                    />
                    <small>
                      可用 {gib(d.free)} / {gib(d.total)} GB
                    </small>
                  </div>
                ))}
              </div>
            </article>
          </div>
          <footer className="computer-footer">
            <span>占用与流量来自本机采样 · GPU 为最繁忙引擎</span>
            <span>
              {native
                ? displayHotkey(settings.hotkey) + " · 显示 / 隐藏"
                : "悬浮窗与全局快捷键请使用 Windows 程序"}
            </span>
          </footer>
        </>
      ) : tab === "details" ? (
        <ComputerDetails
          snapshot={snapshot}
          page={hardwarePage}
          onPage={setHardwarePage}
        />
      ) : tab === "power" ? (
        powerReady ? (
          <ComputerPower
            snapshot={snapshot}
            settings={powerSettings}
            onSave={setPowerSettings}
          />
        ) : (
          <p>读取估算参数…</p>
        )
      ) : (
        <div className="computer-settings">
          <div className="computer-settings-form">
            <h2>悬浮窗设置</h2>
            <label>
              显示方式
              <select
                aria-label="悬浮窗显示方式"
                value={draft.mode}
                disabled={saving || !settingsReady}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    mode: e.target.value as ComputerSettings["mode"],
                  })
                }
              >
                <option value="compact">简洁叠加 · 鼠标穿透</option>
                <option value="mini">小窗 · 可拖动</option>
              </select>
            </label>
            <label>
              初始位置
              <select
                aria-label="悬浮窗位置"
                value={draft.anchor}
                disabled={saving || !settingsReady}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    anchor: e.target.value as ComputerSettings["anchor"],
                  })
                }
              >
                <option value="top-right">右上角</option>
                <option value="top-left">左上角</option>
                <option value="bottom-right">右下角</option>
                <option value="bottom-left">左下角</option>
              </select>
            </label>
            <label>
              不透明度 <output>{Math.round(draft.opacity * 100)}%</output>
              <input
                aria-label="悬浮窗不透明度"
                type="range"
                min=".4"
                max="1"
                step=".01"
                value={draft.opacity}
                disabled={saving || !settingsReady}
                onChange={(e) =>
                  setDraft({ ...draft, opacity: Number(e.target.value) })
                }
              />
            </label>
            <div className="computer-shortcut">
              <span>显示 / 隐藏快捷键</span>
              <div>
                {recording ? (
                  <button
                    className="computer-recorder"
                    ref={recorder}
                    aria-label="录制悬浮窗快捷键"
                    disabled={saving || !settingsReady}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") return;
                      e.preventDefault();
                      if (e.key === "Escape") {
                        setRecording(false);
                        return;
                      }
                      if (["Control", "Alt", "Shift", "Meta"].includes(e.key))
                        return;
                      const key = captureHotkeyFromEvent(e);
                      if (key) {
                        setDraft({ ...draft, hotkey: key });
                        setError("");
                      } else setError("使用 Ctrl / Alt 组合键或 F1–F11");
                    }}
                  >
                    {displayHotkey(draft.hotkey)}
                  </button>
                ) : (
                  <kbd>{displayHotkey(draft.hotkey)}</kbd>
                )}
                <button
                  className="secondary"
                  disabled={!native || saving || !settingsReady}
                  onClick={() => setRecording((v) => !v)}
                >
                  {recording ? "完成录制" : "修改"}
                </button>
              </div>
              {recording && <small>按下组合键，Esc 取消录制</small>}
              {!available && (
                <small className="danger">快捷键已被占用，请更换组合</small>
              )}
            </div>
            <label className="computer-checkbox">
              <input
                type="checkbox"
                checked={draft.closeToTray}
                disabled={saving || !settingsReady}
                onChange={(e) =>
                  setDraft({ ...draft, closeToTray: e.target.checked })
                }
              />
              关闭主窗口后保留在托盘
            </label>
            <button
              className="primary"
              disabled={!native || saving || !settingsReady}
              onClick={save}
            >
              {saving ? "保存中…" : "保存设置"}
            </button>
            {!native && <small>全局快捷键与悬浮窗需要 Windows 程序</small>}
          </div>
          <div className="computer-overlay-preview">
            <strong>显示内容</strong>
            <div className="computer-preview-strip">
              <span>CPU {number(sample?.cpu)}%</span>
              <span>GPU {number(sample?.gpu)}%</span>
              <span>RAM {number(memory)}%</span>
            </div>
            <p>小窗可以拖动、右键隐藏；简洁模式不拦截鼠标操作。</p>
            <p>程序驻留托盘时，快捷键仍然有效；从托盘退出后释放快捷键。</p>
          </div>
        </div>
      )}
    </section>
  );
}
