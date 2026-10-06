import { useState } from "react";
import type { ComputerSnapshot } from "../shared/computer";
import {
  estimatePower,
  powerSettingsSchema,
  type PowerSettings,
} from "../shared/power";
import { api } from "./api";
import { Spark } from "./ComputerPanel";
export default function ComputerPower({
  snapshot,
  settings,
  onSave,
}: {
  snapshot: ComputerSnapshot;
  settings: PowerSettings;
  onSave: (s: PowerSettings) => void;
}) {
  const [draft, setDraft] = useState(settings),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState("");
  const power = estimatePower(
      snapshot.status === "live" ? snapshot.sample : null,
      settings,
    ),
    values = snapshot.history.map(
      (s) => estimatePower(s, settings)?.ac ?? null,
    ),
    valid = values.filter((v): v is number => v != null);
  async function save() {
    const parsed = powerSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await api<PowerSettings>("/computer/power-settings", {
        method: "PUT",
        body: JSON.stringify(parsed.data),
      });
      onSave(saved);
      setNotice("参数已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="hardware-details">
      <div className="hardware-device-grid">
        <article className="computer-panel power-main">
          <div className="hardware-heading">
            <strong>整机功率估算</strong>
            <small>插座侧 · 不含显示器和外接供电设备</small>
          </div>
          <strong className="power-total">
            {power ? "≈ " + Math.round(power.ac) : "—"} <small>W</small>
          </strong>
          <span className="hardware-note">
            {power
              ? `参考范围 ${Math.round(power.low)}–${Math.round(power.high)} W`
              : "等待有效采样"}
          </span>
          <Spark label="整机估算功率曲线" values={values} color="#edab3c" />
          <div className="hardware-heading">
            <span>
              近期平均{" "}
              {valid.length
                ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
                : "—"}{" "}
              W
            </span>
            <span>
              近期最高 {valid.length ? Math.round(Math.max(...valid)) : "—"} W
            </span>
          </div>
        </article>
        <article className="computer-panel">
          <div className="hardware-heading">
            <strong>功耗构成</strong>
            <small>传感器优先</small>
          </div>
          <div className="power-parts">
            {power?.parts.map((p, i) => (
              <div key={p.name + i}>
                <span title={p.detail}>
                  {p.name}
                  <small>{p.source === "sensor" ? "传感器" : "估算"}</small>
                </span>
                <strong>{Math.round(p.watts)} W</strong>
              </div>
            ))}
            <div>
              <span>
                电源损耗<small>估算</small>
              </span>
              <strong>{power ? Math.round(power.loss) : "—"} W</strong>
            </div>
          </div>
        </article>
      </div>
      <div className="hardware-note">
        负载与功耗并非线性关系；参考范围为模型假设，不代表测量精度。要得到准确整机功率，可用插座功率计校准。缺少传感器时使用以下参数。
      </div>
      <article className="computer-panel">
        <div className="hardware-heading">
          <strong>估算参数</strong>
          <small>CPU / GPU 参数均为该类部件的合计功耗</small>
        </div>
        <div className="power-settings">
          {(
            [
              ["cpuIdle", "CPU 空闲 · W"],
              ["cpuFull", "CPU 满载 · W"],
              ["gpuIdle", "GPU 空闲 · W"],
              ["gpuFull", "GPU 满载 · W"],
              ["other", "其他部件 · W"],
              ["efficiency", "电源效率 · %"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                aria-label={label}
                type="number"
                min={key === "efficiency" ? 50 : 0}
                max={key === "efficiency" ? 100 : 3000}
                value={
                  key === "efficiency"
                    ? Math.round(draft[key] * 100)
                    : draft[key]
                }
                disabled={saving}
                onChange={(e) => {
                  setNotice("");
                  setDraft({
                    ...draft,
                    [key]:
                      Number(e.target.value) / (key === "efficiency" ? 100 : 1),
                  });
                }}
              />
            </label>
          ))}
        </div>
        <small className="hardware-note">
          初始值为通用假设，并非自动识别的硬件额定值。无独显时将 GPU 两项均设为
          0。整机估算 =（CPU + GPU + 其他部件）÷ 电源效率。
        </small>
        <div className="power-save">
          <button
            className="primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存估算参数"}
          </button>
          <span role="status">{notice}</span>
        </div>
        {error && (
          <div className="computer-error" role="alert">
            {error}
          </div>
        )}
      </article>
    </div>
  );
}
