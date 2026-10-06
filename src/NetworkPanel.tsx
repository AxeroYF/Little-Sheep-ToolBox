import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Clock3,
  Download,
  Globe2,
  Network,
  Play,
  Square,
  Wifi,
} from "lucide-react";
import { SpeedChart } from "./SpeedChart";
import { NetworkDetails } from "./NetworkDetails";
import { SPEED_PHASE_MS, type NetworkJob, type TestKind, type NetworkInfo, type NetworkIdentity } from "../shared/network";
import { parseNetworkTarget } from "../shared/network-target";
import { api } from "./api";
import { nativeMessage } from "./App";
type NetworkTab=TestKind|"history"|"info";
const labels: Record<TestKind, string> = {
  speed: "测速",
  ping: "Ping",
  dns: "DNS",
  tcp: "TCP",
  trace: "路由追踪",
};
const display = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const statusLabel = {
  running: "运行中",
  complete: "完成",
  failed: "失败",
  cancelled: "已停止",
};
const probeStatus: Record<string, string> = {
  Success: "成功",
  TimedOut: "超时",
  TtlExpired: "中转",
  Failed: "失败",
  Error: "错误",
  DestinationHostUnreachable: "主机不可达",
  DestinationNetworkUnreachable: "网络不可达",
};
export function NetworkPanel() {
  const [tab, setTab] = useState<NetworkTab>("speed"),
    [target, setTarget] = useState("1.1.1.1"),
    [port, setPort] = useState(443);
  const targetChosen = useRef(false);
  const [job, setJob] = useState<NetworkJob | null>(null),
    [reports, setReports] = useState<NetworkJob[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [exported, setExported] = useState(false);
  const [info,setInfo]=useState<NetworkInfo|null>(null),[identity,setIdentity]=useState<NetworkIdentity|null>(null),[infoBusy,setInfoBusy]=useState(false),[infoError,setInfoError]=useState("");
  const [nodeId,setNodeId]=useState(()=>{try{return localStorage.getItem("xiaoyang-network-node")||"nuaa";}catch{return "nuaa";}});
  const identityRequest=useRef<AbortController|null>(null);
  const selectedNode=info?.nodes.find(n=>n.id===nodeId)??info?.nodes[0];
  async function refreshIdentity(){
    if(infoBusy||running)return;setInfoBusy(true);setInfoError("");
    const controller=new AbortController();identityRequest.current=controller;
    try{
      const local=await api<NetworkInfo>("/network/info",{signal:controller.signal});setInfo(local);
      const result=await api<NetworkIdentity>("/network/identity",{method:"POST",body:"{}",signal:controller.signal});setIdentity(result);
    }catch(e){if(!controller.signal.aborted)setInfoError(e instanceof Error?e.message:"网络信息查询失败");}
    finally{if(identityRequest.current===controller)identityRequest.current=null;setInfoBusy(false);}
  }
  const current = useRef<string | null>(null);
  const running = job?.status === "running";
  const loadHistory = () =>
    api<{ reports: NetworkJob[] }>("/network/history")
      .then((r) => setReports(r.reports))
      .catch((e) => setError(e.message));
  useEffect(() => {
    api<NetworkInfo>("/network/info")
      .then(i=>{setInfo(i);setNodeId(current=>i.nodes.some(n=>n.id===current)?current:i.defaultNode);})
      .catch(e=>setInfoError(e.message));
    void loadHistory();
    return () => {
      identityRequest.current?.abort();
      if (current.current)
        void api("/network/jobs/" + current.current + "/cancel", {
          method: "POST",
          body: "{}",
        }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!job || job.status !== "running") {
      current.current = null;
      return;
    }
    current.current = job.id;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api<{ job: NetworkJob }>("/network/jobs/" + job.id);
        if (stopped) return;
        setJob(r.job);
        if (r.job.status === "running") timer = setTimeout(poll, 500);
        else {
          current.current = null;
          void loadHistory();
        }
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : "连接失败");
          timer = setTimeout(poll, 1500);
        }
      }
    };
    timer = setTimeout(poll, 300);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    const webview = (
      window as unknown as {
        chrome?: {
          webview?: {
            addEventListener: (s: string, f: (e: MessageEvent) => void) => void;
            removeEventListener: (
              s: string,
              f: (e: MessageEvent) => void,
            ) => void;
          };
        };
      }
    ).chrome?.webview;
    const done = (e: MessageEvent) => {
      if (e.data?.type === "exported") {
        setExported(true);
      }
    };
    webview?.addEventListener("message", done);
    return () => webview?.removeEventListener("message", done);
  }, []);
  async function start() {
    if (tab === "history" || tab === "info") return;
    setError("");
    setExported(false);
    setBusy(true);
    try {
      const parsed = tab === "speed" ? null : parseNetworkTarget(target);
      const probePort = parsed?.port ?? port;
      const r = await api<{ job: NetworkJob }>("/network/jobs", {
        method: "POST",
        body: JSON.stringify({
          kind: tab,
          target: parsed?.host ?? selectedNode?.host ?? "speed.nuaa.edu.cn",
          nodeId: selectedNode?.id || "nuaa",
          port: probePort,
          mode: "timed",
        }),
      });
      if (parsed) {
        targetChosen.current = true;
        setTarget(r.job.result.target);
        setPort(probePort);
      }
      current.current = r.job.id;
      setJob(r.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败");
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!job) return;
    setBusy(true);
    try {
      await api("/network/jobs/" + job.id + "/cancel", {
        method: "POST",
        body: "{}",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "停止失败");
    } finally {
      setBusy(false);
    }
  }
  function select(value: NetworkTab) {
    if (running || busy) return;
    identityRequest.current?.abort();
    setTab(value);
    setJob(null);
    setError("");
    setExported(false);
    if (!targetChosen.current) {
      if (value === "dns") setTarget("cloudflare.com");
      else if (value === "ping" || value === "tcp" || value === "trace") setTarget("1.1.1.1");
    }
    if (value === "history") void loadHistory();
  }
  function exportReport(report: NetworkJob) {
    setExported(false);
    const data = JSON.stringify(
      {
        application: "小羊网络测试",
        version: "0.2.0",
        exportedAt: new Date().toISOString(),
        ...report,
      },
      null,
      2,
    );
    if ((window as unknown as { workboxNative?: boolean }).workboxNative) {
      nativeMessage({ action: "export", data });
    } else {
      const url = URL.createObjectURL(
        new Blob([data], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "小羊网络测试-" + report.id + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  const result = job?.result;
  return (
    <div className="network-content">
      <div className="network-tabs">
        {([...Object.keys(labels), "info", "history"] as NetworkTab[]).map(
          (key) => (
            <button
              key={key}
              disabled={!!running || busy}
              className={key === tab ? "active" : ""}
              onClick={() => select(key)}
            >
              {key === "history" ? (
                <Clock3 size={16} />
              ) : key === "speed" ? (
                <Activity size={16} />
              ) : key === "dns" || key === "info" ? (
                <Globe2 size={16} />
              ) : key === "trace" ? (
                <Network size={16} />
              ) : (
                <Wifi size={16} />
              )}{" "}
              {key === "history" ? "历史记录" : key === "info" ? "网络信息" : labels[key]}
            </button>
          ),
        )}
      </div>
      {tab === "info" ? <NetworkDetails info={info} identity={identity} loading={infoBusy} error={infoError} onRefresh={()=>void refreshIdentity()}/> : tab === "history" ? (
        <section className="result-panel history-panel">
          {reports.length === 0 ? (
            <div className="empty">暂无记录</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>测试</th>
                  <th>目标</th>
                  <th>结果</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.startedAt).toLocaleString()}</td>
                    <td>{labels[r.kind]}</td>
                    <td>{r.result.target}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => {
                          setJob(r);
                          setTab(r.kind);
                          if (r.kind !== "speed") {
                            targetChosen.current = true;
                            setTarget(r.result.target);
                          }
                          if(r.result.nodeId)setNodeId(r.result.nodeId);
                          if (r.result.port) setPort(r.result.port);
                        }}
                      >
                        {statusLabel[r.status]}
                      </button>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        title="导出报告"
                        aria-label="导出报告"
                        onClick={() => exportReport(r)}
                      >
                        <Download size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <>
          <section className="test-controls">
            {tab === "speed" ? (
              <>
                <label className="node-picker"><Globe2 size={18}/><div><select aria-label="测速节点" value={selectedNode?.id||nodeId} disabled={!!running||busy||!info} onChange={event=>{const id=event.target.value;setNodeId(id);setJob(null);setError("");try{localStorage.setItem("xiaoyang-network-node",id);}catch{}}}>{info?.nodes.map(node=><option value={node.id} key={node.id}>{node.name}</option>)}</select><small>{selectedNode?.region||"正在读取节点"} · 下载 / 上传</small></div></label>
                <span className="speed-duration-label">下载 15 秒 → 上传 15 秒<small>按时间测速 · 流量随网速变化</small></span>
              </>
            ) : (
              <>
                <label className="target-label">
                  <span>{tab === "dns" ? "域名" : "目标"}</span>
                  <input
                    aria-label={tab === "dns" ? "域名" : "目标"}
                    value={target}
                    disabled={!!running || busy}
                    onChange={(e) => { targetChosen.current = true; setTarget(e.target.value); setError(""); }}
                    placeholder="域名、IP 或网址"
                  />
                </label>
                {tab === "tcp" && (
                  <label className="port-label">
                    <span>端口</span>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={port}
                      disabled={!!running}
                      onChange={(e) => setPort(Number(e.target.value))}
                    />
                  </label>
                )}
              </>
            )}
            <button
              className={
                running ? "secondary stop-button" : "primary start-button"
              }
              disabled={busy || infoBusy || (!target.trim() && tab !== "speed") || (tab === "speed" && !info)}
              onClick={running ? stop : start}
            >
              {running ? <Square size={15} /> : <Play size={15} />}{" "}
              {running ? "停止" : "开始测试"}
            </button>
          </section>
          {tab === "ping" || tab === "tcp" ? (
            <div className="metrics">
              <Metric
                title="平均延迟"
                value={display(result?.latencyMs)}
                unit="ms"
              />
              <Metric
                title="抖动"
                value={display(result?.jitterMs)}
                unit="ms"
              />
              <Metric
                title={tab === "tcp" ? "连接失败率" : "丢包率"}
                value={display(result?.lossPercent)}
                unit="%"
              />
              <Metric
                title="成功 / 总数"
                value={
                  result?.sent !== undefined
                    ? `${result.received} / ${result.sent}`
                    : "—"
                }
                unit=""
              />
            </div>
          ) : null}
          <section className="result-panel">
            <div className="result-heading">
              <h2>
                {tab === "speed"
                  ? "速度曲线"
                  : tab === "dns"
                    ? "解析结果"
                    : tab === "trace"
                      ? "路由节点"
                      : "延迟曲线"}
              </h2>
              <span className={running ? "status-running" : "muted"}>
                {job?.phase ?? "待测试"}
              </span>
            </div>
            {tab === "speed" ? (
              <>
                <div className="speed-charts">{(['download','upload'] as const).map(direction=>{
                  const active=!!running&&result?.activeDirection===direction;
                  const average=direction==='download'?result?.downloadMbps:result?.uploadMbps;
                  const peak=direction==='download'?result?.downloadPeakMbps:result?.uploadPeakMbps;
                  const duration=direction==='download'?result?.downloadDurationMs:result?.uploadDurationMs;
                  const samples=result?.speedSamples??[];
                  const hasSamples=samples.some(s=>s.direction===direction);
                  const status=active?'测试中':average!==undefined?'完成':running&&direction==='upload'?'等待下载完成':hasSamples?statusLabel[job!.status]:'待测试';
                  // Old traffic-based reports keep their actual per-direction span.
                  const legacy=samples.filter(s=>s.direction===direction);
                  const targetDuration=result?.phaseDurationMs??(legacy.length?Math.max(1000,legacy.at(-1)!.elapsedMs-legacy[0].elapsedMs):SPEED_PHASE_MS);
                  return <SpeedChart key={(job?.id??'empty')+direction} direction={direction} samples={samples} running={active} status={status} average={average} peak={peak} durationMs={targetDuration} elapsedMs={active?result?.phaseElapsedMs:duration}/>;
                })}</div>
                <div className="speed-progress-meta"><span>{result?.nodeName??selectedNode?.name??"—"} · 直连 HTTP · 先下载，后上传</span><span>{job?job.progress+"%":"待测试"} · 已用 {display(((result?.downloadedBytes??0)+(result?.uploadedBytes??0))/1048576)} MiB</span></div>
                {job&&!result?.speedSamples?.length&&job.status!=="running"&&<p className="network-info-note">此记录没有速度采样。</p>}
              </>
            ) : tab === "ping" || tab === "tcp" ? (
              <LatencyChart samples={result?.samples ?? []} />
            ) : tab === "dns" ? (
              <div className="dns-results">
                {result?.addresses?.length ? (
                  <>
                    <div className="dns-time">
                      {display(result.dnsMs)} <small>ms</small>
                    </div>
                    {result.addresses.map((address) => (
                      <div className="address-row" key={address}>
                        <span className="badge">
                          {address.includes(":") ? "AAAA" : "A"}
                        </span>
                        <code>{address}</code>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="empty">{running ? "解析中…" : "—"}</div>
                )}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>跳数</th>
                    <th>地址</th>
                    <th>耗时</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {result?.samples?.map((s) => (
                    <tr key={s.index}>
                      <td>{s.index}</td>
                      <td>
                        {s.address === "0.0.0.0" ? "—" : (s.address ?? "—")}
                      </td>
                      <td>{display(s.ms)} ms</td>
                      <td>{probeStatus[s.status] ?? s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(tab === "ping" || tab === "tcp") && (
              <div className="chart-footer">
                <span>最小 {display(result?.minMs)} ms</span>
                <span>最大 {display(result?.maxMs)} ms</span>
                <span>
                  {tab === "ping" ? "ICMP · 10 次" : "TCP 握手 · 8 次"}
                </span>
              </div>
            )}
          </section>
          {tab === "ping" && result?.lossPercent === 100 && (
            <div className="inline-note">目标可能禁用了 ICMP。</div>
          )}
          {tab === "trace" &&
            job?.status === "complete" &&
            !result?.reached && (
              <div className="inline-note">
                20 跳内未到达目标，部分节点可能不响应 ICMP。
              </div>
            )}
          {job && job.status !== "running" && (
            <div className="report-footer">
              <span className="muted">
                {new Date(job.startedAt).toLocaleString()} ·{" "}
                {statusLabel[job.status]}
              </span>
              <button className="secondary" onClick={() => exportReport(job)}>
                <Download size={16} />
                导出报告
              </button>
            </div>
          )}
        </>
      )}
      {(error || job?.error) && (
        <div className="form-error" role="alert">
          {error || job?.error}
        </div>
      )}
      {exported && (
        <div className="inline-note" role="status">
          报告已保存
        </div>
      )}
      {tab!=="info"&&<div className="network-info-link"><span>{identity?.system.ip?"公网 IP · "+identity.system.ip:"公网 IP、归属地、代理和本地连接"}</span><button className="text-button" disabled={!!running||busy} onClick={()=>select("info")}>网络信息</button></div>}

    </div>
  );
}
function Metric({
  title,
  value,
  unit,
  icon,
}: {
  title: string;
  value: string;
  unit: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-title">
        {icon}
        {title}
      </div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
    </div>
  );
}
function LatencyChart({
  samples,
}: {
  samples: NonNullable<NetworkJob["result"]["samples"]>;
}) {
  const max = Math.max(10, ...samples.map((s) => s.ms ?? 0));
  const width = 720,
    height = 160,
    pad = 12;
  return (
    <div className="latency-chart">
      <div className="chart-axis">
        <span>{display(max)} ms</span>
        <span>0</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        aria-label="延迟采样曲线"
        role="img"
      >
        {[pad, height / 2, height - pad].map((y) => (
          <line key={y} x1="0" y1={y} x2={width} y2={y} className="grid-line" />
        ))}
        {samples.map((s, i) => {
          const x = pad + (i * (width - pad * 2)) / 9,
            y = height - pad - ((s.ms ?? 0) / max) * (height - pad * 2);
          const prev = samples[i - 1];
          return (
            <g key={s.index}>
              {i > 0 && s.ms !== null && prev.ms !== null && (
                <line
                  x1={pad + ((i - 1) * (width - pad * 2)) / 9}
                  y1={height - pad - (prev.ms / max) * (height - pad * 2)}
                  x2={x}
                  y2={y}
                  className="data-line"
                />
              )}
              {s.ms === null ? (
                <text x={x} y={height - pad} className="failed-point">
                  ×
                </text>
              ) : (
                <circle cx={x} cy={y} r="4" className="data-point">
                  <title>
                    {s.index}: {s.ms} ms
                  </title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
      {!samples.length && <span className="chart-placeholder">等待采样</span>}
    </div>
  );
}
