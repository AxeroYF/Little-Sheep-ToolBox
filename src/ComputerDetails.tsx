import { useState } from "react";
import type { ComputerSnapshot, HardwareSensor } from "../shared/computer";
import { Spark } from "./ComputerPanel";

export type HardwarePage =
  | "cpu"
  | "gpu"
  | "memory"
  | "disk"
  | "network"
  | "board";
const n = (v: number | null | undefined, d = 0) =>
  v == null ? "不可用" : v.toFixed(d);
const gb = (v: number | null | undefined) =>
  v == null ? "不可用" : (v / 1073741824).toFixed(1) + " GB";
const rate = (v: number | null | undefined) =>
  v == null
    ? "不可用"
    : v >= 1048576
      ? (v / 1048576).toFixed(1) + " MB/s"
      : (v / 1024).toFixed(1) + " KB/s";
const units: Record<string, string> = {
  Temperature: "°C",
  Load: "%",
  Control: "%",
  Level: "%",
  Clock: "MHz",
  Fan: "RPM",
  Voltage: "V",
  Current: "A",
  Power: "W",
  Data: "GB",
  SmallData: "MB",
  Throughput: "B/s",
  Energy: "mWh",
  Capacity: "mWh",
  Frequency: "Hz",
  TimeSpan: "s",
};
const types: Record<string, string> = {
  Temperature: "温度",
  Load: "占用",
  Control: "风扇输出",
  Level: "水平",
  Clock: "频率",
  Fan: "转速",
  Voltage: "电压",
  Current: "电流",
  Power: "功耗",
  Data: "容量",
  SmallData: "容量",
  Throughput: "流量",
  Factor: "系数",
  Energy: "能量",
  Frequency: "频率",
  TimeSpan: "时长",
};
const names: Record<string, string> = {
  "CPU Package": "CPU 封装",
  "CPU Total": "CPU 总体",
  "CPU Core": "CPU 核心",
  "CPU Core Max": "最高核心温度",
  "CPU Core Average": "平均核心温度",
  "GPU Core": "GPU 核心",
  "GPU Memory": "显存",
  "GPU Hot Spot": "GPU 热点",
  "GPU Memory Junction": "显存结温",
  "GPU Fan": "GPU 风扇",
  "GPU Package": "GPU 封装",
  "Memory Used": "已用内存",
  "Memory Available": "可用内存",
  "Used Space": "已用空间",
  "Remaining Life": "剩余寿命",
  "Data Read": "累计读取",
  "Data Written": "累计写入",
  "Read Rate": "读取速度",
  "Write Rate": "写入速度",
  "Power On Count": "通电次数",
  "Power On Hours": "通电时长",
  "Battery Level": "电量",
  "Wear Level": "损耗",
};
const sensorName = (s: HardwareSensor) =>
  names[s.name] ??
  s.name
    .replace(/^CPU Core #/, "CPU 核心 #")
    .replace(/^CPU Core /, "CPU 核心 ")
    .replace(/^GPU Fan /, "GPU 风扇 ");
function value(v: number | null | undefined, type: string) {
  return v == null
    ? "不可用"
    : type === "Throughput"
      ? rate(v)
      : n(v, ["Voltage", "Current"].includes(type) ? 2 : 1) +
        " " +
        (units[type] ?? "");
}
function Fields({ items }: { items: [string, string][] }) {
  return (
    <dl className="hardware-fields">
      {items.map(([label, text]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{text || "不可用"}</dd>
        </div>
      ))}
    </dl>
  );
}
function Sensors({
  snapshot,
  categories,
}: {
  snapshot: ComputerSnapshot;
  categories: string[];
}) {
  const [chosen, setChosen] = useState("");
  const active =
    snapshot.status === "live" && snapshot.sample?.sensorStatus === "live";
  const sensors = (snapshot.sample?.sensors ?? []).filter((s) =>
    categories.includes(s.category),
  );
  const groups = [...new Set(sensors.map((s) => s.hardwareId))];
  const selected = sensors.find((s) => s.id === chosen);
  const readings = (id: string) =>
    snapshot.history.map((s) =>
      s.sensorStatus === "live"
        ? (s.sensors?.find((v) => v.id === id)?.value ?? null)
        : null,
    );
  return (
    <div className="hardware-sensors">
      <div className="hardware-heading">
        <strong>传感器</strong>
        <small>
          {snapshot.sample?.sensorStatus === "starting"
            ? "正在读取"
            : (snapshot.sample?.sensorError ?? "LibreHardwareMonitor · 3 秒")}
        </small>
      </div>
      {selected && (
        <article className="computer-panel hardware-trend">
          <div className="computer-panel-title">
            <span>
              {selected.hardware} · {sensorName(selected)}
            </span>
            <strong>
              {value(active ? selected.value : null, selected.type)}
            </strong>
            <button className="secondary" onClick={() => setChosen("")}>
              关闭曲线
            </button>
          </div>
          <Spark
            label={sensorName(selected) + " 传感器曲线"}
            values={readings(selected.id)}
            percent={["Load", "Control", "Level"].includes(selected.type)}
          />
          <small>
            最近 60 个采样 · {units[selected.type] ?? selected.type}
          </small>
        </article>
      )}
      {groups.map((id) => {
        const rows = sensors.filter((s) => s.hardwareId === id);
        return (
          <details
            className="hardware-sensor-group"
            key={id}
            open={groups.length === 1}
          >
            <summary>
              {rows[0].hardware}
              <small>{rows.length} 项</small>
            </summary>
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>类型</th>
                  <th>当前</th>
                  <th>最低</th>
                  <th>最高</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const all = readings(s.id).filter(
                    (v): v is number => v != null,
                  );
                  return (
                    <tr key={s.id}>
                      <td>
                        <button
                          title="查看曲线"
                          className="hardware-sensor-link"
                          onClick={() => setChosen(s.id)}
                        >
                          {sensorName(s)}
                        </button>
                      </td>
                      <td>{types[s.type] ?? s.type}</td>
                      <td>{value(active ? s.value : null, s.type)}</td>
                      <td>
                        {value(all.length ? Math.min(...all) : null, s.type)}
                      </td>
                      <td>
                        {value(all.length ? Math.max(...all) : null, s.type)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        );
      })}
      {!groups.length && (
        <p className="hardware-empty">
          {snapshot.sample?.sensorStatus === "starting"
            ? "正在读取扩展传感器…"
            : "当前设备或权限未提供此类传感器"}
        </p>
      )}
      <small className="hardware-note">
        最低 / 最高取当前保留的采样。CPU
        温度、主板风扇等取决于设备支持和已有的驱动权限。
      </small>
    </div>
  );
}
export default function ComputerDetails({
  snapshot,
  page,
  onPage,
}: {
  snapshot: ComputerSnapshot;
  page: HardwarePage;
  onPage: (p: HardwarePage) => void;
}) {
  const [sort, setSort] = useState("index");
  const { info, history } = snapshot,
    s = snapshot.status === "live" ? snapshot.sample : null;
  const processors = [...(snapshot.sample?.processors ?? [])];
  if (sort === "load")
    processors.sort((a, b) => (b.usage ?? -1) - (a.usage ?? -1));
  return (
    <div className="hardware-details">
      <nav className="hardware-categories" aria-label="硬件分类">
        {(
          [
            ["cpu", "CPU"],
            ["gpu", "显卡"],
            ["memory", "内存"],
            ["disk", "磁盘"],
            ["network", "网卡"],
            ["board", "主板与电池"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={page === id}
            onClick={() => onPage(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {page === "cpu" && (
        <>
          <article className="computer-panel">
            <div className="hardware-heading">
              <strong>{info?.cpu ?? "CPU"}</strong>
              <span>总占用 {n(s?.cpu)}%</span>
            </div>
            <Fields
              items={[
                ["物理核心", n(info?.cpuDetails?.cores)],
                ["逻辑处理器", n(info?.logicalProcessors)],
                ["插槽", n(info?.cpuDetails?.sockets)],
                [
                  "当前频率",
                  s?.cpuMhz == null
                    ? "不可用"
                    : (s.cpuMhz / 1000).toFixed(2) + " GHz",
                ],
                [
                  "L2 缓存",
                  info?.cpuDetails?.l2KB == null
                    ? "不可用"
                    : n(info.cpuDetails.l2KB / 1024, 1) + " MB",
                ],
                [
                  "L3 缓存",
                  info?.cpuDetails?.l3KB == null
                    ? "不可用"
                    : n(info.cpuDetails.l3KB / 1024, 1) + " MB",
                ],
              ]}
            />
          </article>
          <div className="hardware-heading">
            <strong>逻辑处理器</strong>
            <small>最近 60 个采样 · 0–100%</small>
            <select
              aria-label="逻辑处理器排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="index">按编号</option>
              <option value="load">按当前负载</option>
            </select>
          </div>
          <div className="hardware-processors">
            {processors.map((p) => (
              <article
                key={p.id}
                className="computer-panel"
                aria-label={"逻辑处理器 " + p.id}
              >
                <div>
                  <span>
                    {processors.some((c) => c.group > 0)
                      ? `组 ${p.group} · CPU ${p.index}`
                      : `CPU ${p.index}`}
                  </span>
                  <strong>
                    {n(s ? p.usage : null, 1)}
                    {s && p.usage != null ? "%" : ""}
                  </strong>
                </div>
                <Spark
                  label={"逻辑处理器 " + p.id + " 负载曲线"}
                  values={history.map(
                    (v) =>
                      v.processors?.find((c) => c.id === p.id)?.usage ?? null,
                  )}
                  percent
                />
              </article>
            ))}
          </div>
          {!processors.length && (
            <p className="hardware-empty">正在读取逻辑处理器…</p>
          )}
          <Sensors snapshot={snapshot} categories={["Cpu"]} />
        </>
      )}
      {page === "gpu" && (
        <>
          <div className="hardware-device-grid">
            {(s?.gpus ?? snapshot.sample?.gpus ?? []).map((g, i) => (
              <article className="computer-panel" key={g.name + i}>
                <div className="hardware-heading">
                  <strong>{g.name}</strong>
                </div>
                <Fields
                  items={[
                    ["核心占用", s && g.usage!=null ? n(g.usage, 1) + "%" : "不可用"],
                    [
                      "温度",
                      s ? value(g.temperature, "Temperature") : "不可用",
                    ],
                    [
                      "专用显存",
                      s
                        ? gb(g.memoryUsed) + " / " + gb(g.memoryTotal)
                        : "不可用",
                    ],
                    [
                      "驱动版本",
                      info?.gpuDetails?.find((d) => d.name === g.name)
                        ?.driver ?? "",
                    ],
                  ]}
                />
                <Spark
                  label={g.name + " 占用曲线"}
                  values={history.map(
                    (v) => v.gpus.find((d) => d.name === g.name)?.usage ?? null,
                  )}
                  percent
                  color="#2ac59b"
                />
              </article>
            ))}
          </div>
          {info?.gpuDetails
            ?.filter(
              (g) => !snapshot.sample?.gpus.some((v) => v.name === g.name),
            )
            .map((g) => (
              <article className="computer-panel" key={g.name}>
                <strong>{g.name}</strong>
                <Fields
                  items={[
                    ["驱动版本", g.driver],
                    ["输出分辨率", g.resolution],
                  ]}
                />
              </article>
            ))}
          <Sensors
            snapshot={snapshot}
            categories={["GpuNvidia", "GpuAmd", "GpuIntel"]}
          />
        </>
      )}
      {page === "memory" && (
        <>
          <article className="computer-panel">
            <div className="hardware-heading">
              <strong>系统内存</strong>
            </div>
            <Fields
              items={[
                ["已用", gb(s?.memoryUsed)],
                ["可用", gb(s?.memoryAvailable)],
                ["物理总量", gb(s?.memoryTotal)],
                ["已提交", gb(s?.commitUsed)],
                ["提交上限", gb(s?.commitLimit)],
                ["已识别内存条", String(info?.memoryModules?.length ?? 0)],
              ]}
            />
            <Spark
              label="内存使用率曲线"
              values={history.map((v) =>
                v.memoryTotal && v.memoryUsed != null
                  ? (v.memoryUsed / v.memoryTotal) * 100
                  : null,
              )}
              percent
              color="#a083ff"
            />
          </article>
          <div className="hardware-device-grid">
            {info?.memoryModules?.map((m, i) => (
              <article className="computer-panel" key={m.slot + i}>
                <strong>{m.slot || "内存 " + (i + 1)}</strong>
                <Fields
                  items={[
                    ["容量", gb(m.capacity)],
                    ["厂商", m.manufacturer],
                    ["型号", m.part],
                    [
                      "配置速率",
                      m.configuredSpeed
                        ? n(m.configuredSpeed) + " MT/s"
                        : "不可用",
                    ],
                    ["标称速率", m.speed ? n(m.speed) + " MT/s" : "不可用"],
                  ]}
                />
              </article>
            ))}
          </div>
          {!info?.memoryModules?.length && (
            <p className="hardware-empty">内存条信息不可用</p>
          )}
          <Sensors snapshot={snapshot} categories={["Memory"]} />
        </>
      )}
      {page === "disk" && (
        <>
          <div className="hardware-device-grid">
            {(snapshot.sample?.disks ?? []).map((d) => (
              <article className="computer-panel" key={d.id}>
                <div className="hardware-heading">
                  <strong>磁盘 {d.id}</strong>
                  <span>{s && d.active!=null ? n(d.active, 1) + "% 活动" : "不可用"}</span>
                </div>
                <Fields
                  items={[
                    [
                      "型号",
                      info?.physicalDisks?.find(
                        (p) => p.index === Number(d.id.split(" ")[0]),
                      )?.model ?? "",
                    ],
                    [
                      "容量",
                      gb(
                        info?.physicalDisks?.find(
                          (p) => p.index === Number(d.id.split(" ")[0]),
                        )?.size,
                      ),
                    ],
                    ["读取", rate(s ? d.read : null)],
                    ["写入", rate(s ? d.write : null)],
                    ["队列长度", n(s ? d.queue : null, 1)],
                  ]}
                />
                <Spark
                  label={"磁盘 " + d.id + " 活动率"}
                  values={history.map(
                    (v) => v.disks?.find((p) => p.id === d.id)?.active ?? null,
                  )}
                  percent
                />
              </article>
            ))}
          </div>
          <article className="computer-panel">
            <div className="hardware-heading">
              <strong>分区容量</strong>
            </div>
            <div className="hardware-volumes">
              {info?.drives.map((d) => (
                <div key={d.name}>
                  <strong>
                    {d.name} {d.label}
                  </strong>
                  <progress
                    aria-label={d.name + " 容量占用"}
                    max={d.total ?? 1}
                    value={
                      d.total != null && d.free != null ? d.total - d.free : 0
                    }
                  />
                  <span>
                    {d.format} · 可用 {gb(d.free)} / {gb(d.total)}
                  </span>
                </div>
              ))}
            </div>
          </article>
          <Sensors snapshot={snapshot} categories={["Storage"]} />
        </>
      )}
      {page === "network" && (
        <div className="hardware-device-grid">
          {(snapshot.sample?.networks ?? []).map((d) => (
            <article className="computer-panel" key={d.id}>
              <div className="hardware-heading">
                <strong>{d.name}</strong>
                <small>{d.virtual ? "虚拟网卡" : "物理网卡"}</small>
              </div>
              <span className="hardware-note">{d.description}</span>
              <Fields
                items={[
                  ["接收", rate(s ? d.receive : null)],
                  ["发送", rate(s ? d.send : null)],
                  [
                    "协商链路速率",
                    d.linkSpeed
                      ? d.linkSpeed >= 1e9
                        ? n(d.linkSpeed / 1e9, 1) + " Gbps"
                        : n(d.linkSpeed / 1e6) + " Mbps"
                      : "不可用",
                  ],
                  ["累计接收", gb(s ? d.receivedBytes : null)],
                  ["累计发送", gb(s ? d.sentBytes : null)],
                  ["本机 IP", d.addresses?.join(" · ") ?? ""],
                ]}
              />
              <div className="computer-dual">
                <div>
                  <span>接收</span>
                  <Spark
                    label={d.name + " 接收曲线"}
                    values={history.map(
                      (v) =>
                        v.networks.find((p) => p.id === d.id)?.receive ?? null,
                    )}
                  />
                </div>
                <div>
                  <span>发送</span>
                  <Spark
                    label={d.name + " 发送曲线"}
                    values={history.map(
                      (v) =>
                        v.networks.find((p) => p.id === d.id)?.send ?? null,
                    )}
                    color="#a083ff"
                  />
                </div>
              </div>
              <small className="hardware-note">
                累计值来自系统网卡计数器；链路速率不代表互联网测速结果。
              </small>
            </article>
          ))}
        </div>
      )}
      {page === "board" && (
        <>
          <article className="computer-panel">
            <div className="hardware-heading">
              <strong>主板</strong>
            </div>
            <Fields
              items={[
                ["厂商", info?.board?.manufacturer ?? ""],
                ["型号", info?.board?.model ?? ""],
                ["BIOS 版本", info?.board?.bios ?? ""],
                ["操作系统", info?.os ?? ""],
              ]}
            />
          </article>
          <Sensors
            snapshot={snapshot}
            categories={[
              "Motherboard",
              "SuperIO",
              "EmbeddedController",
              "Battery",
            ]}
          />
        </>
      )}
    </div>
  );
}
