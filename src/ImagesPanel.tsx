import { useEffect, useRef, useState } from "react";
import { Check, FolderOpen, ImagePlus, Images, Play, Square, Trash2, X } from "lucide-react";
import { api } from "./api";
import { nativeMessage } from "./App";
import { IMAGE_BATCH_LIMIT, IMAGE_FILE_LIMIT, IMAGE_FORMATS, IMAGE_INPUT_ACCEPT, type ImageSettings, type ImageWorkshopState } from "../shared/images";
import "./images.css";
import OcrDialog, {type OcrImage} from './OcrDialog';

const empty: ImageWorkshopState = { images: [], job: null, outputDirectory: "" };
const bytes = (n: number) => n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB";
const statusText = { queued: "等待", running: "转换中", complete: "完成", failed: "失败", cancelled: "已停止", partial: "部分完成" };
const errorText = (e: unknown) => e instanceof Error ? e.message : "操作失败";
export default function ImagesPanel() {
  const [ocr,setOcr]=useState<OcrImage|null>(null);
  const [state, setState] = useState<ImageWorkshopState>(empty), [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState<string | null>(null);
  const [settings, setSettings] = useState<ImageSettings>({ format: "png", quality: 85, lossless: false, background: "#ffffff" });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [importing, setImporting] = useState(""), [dragging, setDragging] = useState(false), [stopping, setStopping] = useState(false);
  const files = useRef<HTMLInputElement>(null), alive = useRef(true), upload = useRef<AbortController | null>(null);
  const native = !!(window as unknown as { workboxNative?: boolean }).workboxNative;
  const working = state.job?.status === "running", locked = busy || working;
  const active = state.images.find(i => i.id === preview), job = state.job;
  const result = job?.items.find(i => i.imageId === preview);
  const completed = job?.items.filter(i => i.status === "complete").length ?? 0;
  const done = job?.items.filter(i => i.status !== "queued" && i.status !== "running").length ?? 0;
  const allSelected = state.images.length > 0 && selected.length === state.images.length;
  const lossy = settings.format === "jpeg" || settings.format === "avif" || (settings.format === "webp" && !settings.lossless);
  async function refresh() { const next = await api<ImageWorkshopState>("/images"); if (alive.current) setState(next); return next; }
  useEffect(() => {
    alive.current = true; void refresh().then(s => { if (alive.current) { setSelected(s.images.map(i => i.id)); setPreview(s.images[0]?.id ?? null); } }).catch(e => { if (alive.current) setError(errorText(e)); });
    const bridge = (window as any).chrome?.webview;
    const message = (event: MessageEvent) => {
      if (event.data?.type === "image-folder-selected") { setBusy(false); void refresh().catch(e => setError(errorText(e))); }
      if (event.data?.type === "image-native-error") { setBusy(false); setError(event.data.message); }
    };
    bridge?.addEventListener("message", message);
    return () => { alive.current = false; upload.current?.abort(); bridge?.removeEventListener("message", message); };
  }, []);
  useEffect(() => {
    if (!working) { setStopping(false); return; }
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { const s = await api<ImageWorkshopState>("/images"); if (!stop) setState(s); }
      catch (e) { if (!stop) setError(errorText(e)); }
      if (!stop) timer = setTimeout(tick, 350);
    };
    timer = setTimeout(tick, 150); return () => { stop = true; clearTimeout(timer); };
  }, [working]);
  async function addFiles(input: FileList | File[]) {
    if (locked) return; setBusy(true); setError("");
    const controller = new AbortController(); upload.current = controller;
    const list = Array.from(input), failures: string[] = [], imported: string[] = [];
    try {
      const available = Math.max(0, IMAGE_BATCH_LIMIT - state.images.length);
      if (list.length > available) failures.push("一次最多添加 50 张图片");
      for (const [index, file] of list.slice(0, available).entries()) {
        if (controller.signal.aborted) break;
        setImporting(`添加 ${index + 1} / ${Math.min(list.length, available)}`);
        try {
          if (file.size > IMAGE_FILE_LIMIT) throw new Error("超过 25 MB");
          const response = await api<{ image: { id: string } }>("/images/import?name=" + encodeURIComponent(file.name), {
            method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file, signal: controller.signal,
          });
          imported.push(response.image.id);
          if (alive.current) { await refresh(); setSelected(old => [...old, response.image.id]); setPreview(response.image.id); }
        } catch (e) { if (!controller.signal.aborted) failures.push(file.name + "：" + errorText(e)); }
      }
      if (alive.current) setError(failures.join("\n"));
    } finally { if (alive.current) { setBusy(false); setImporting(""); } if (upload.current === controller) upload.current = null; }
  }
  async function remove(all = false) {
    if (locked) return; setBusy(true); setError("");
    try {
      if (all) await api("/images", { method: "DELETE", body: "{}" });
      else for (const id of selected) await api("/images/" + id, { method: "DELETE", body: "{}" });
      const s = await refresh(); setSelected([]); setPreview(s.images[0]?.id ?? null);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function convert() {
    setBusy(true); setError("");
    try { await api("/images/convert", { method: "POST", body: JSON.stringify({ ids: selected, settings }) }); await refresh(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function cancel() { setStopping(true); try { await api("/images/cancel", { method: "POST", body: "{}" }); } catch (e) { setError(errorText(e)); setStopping(false); } }
  function reveal(imageId?: string) { nativeMessage({ action: "image-reveal", jobId: job?.id, imageId }); }
  return <section className={"images-app" + (dragging ? " dragging" : "")} aria-label="图片格式转换"
    onDragOver={e => { e.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={e => { e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files); }}>
    <div className="images-toolbar">
      <button className="secondary" disabled={!!locked||!active} onClick={()=>active&&setOcr({url:`/api/images/${active.id}/ocr-input`,preview:`/api/images/${active.id}/preview`,name:active.name})}>文字识别</button>
      <button className="primary" onClick={() => files.current?.click()} disabled={!!locked}><ImagePlus size={17}/>添加图片</button>
      <button className="secondary" onClick={() => void remove()} disabled={!!locked || !selected.length}><Trash2 size={16}/>移除选中</button>
      <button className="secondary" onClick={() => void remove(true)} disabled={!!locked || !state.images.length}>清空</button>
      <input ref={files} aria-label="添加图片文件" hidden type="file" multiple accept={IMAGE_INPUT_ACCEPT} onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }}/>
      <span className="images-count">{importing || `${state.images.length} 张 · 已选 ${selected.length} 张`}</span>
    </div>
    {error && <div className="images-error" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError("")}><X size={16}/></button></div>}
    <div className="images-settings">
      <label>输出格式<select aria-label="输出格式" value={settings.format} disabled={!!locked} onChange={e => setSettings({ ...settings, format: e.target.value as ImageSettings["format"] })}>{Object.entries(IMAGE_FORMATS).map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
      <label className={!lossy ? "images-dimmed" : ""}>质量 <span>{lossy ? settings.quality : "无损"}</span><input type="range" aria-label="转换质量" min={1} max={100} disabled={!!locked || !lossy} value={settings.quality} onChange={e => setSettings({ ...settings, quality: Number(e.target.value) })}/></label>
      {settings.format === "webp" && <label className="images-check"><input type="checkbox" checked={settings.lossless} disabled={!!locked} onChange={e => setSettings({ ...settings, lossless: e.target.checked })}/>无损 WebP</label>}
      {settings.format === "jpeg" && <label className="images-background">透明区域填充<input aria-label="透明区域填充颜色" type="color" value={settings.background} disabled={!!locked} onChange={e => setSettings({ ...settings, background: e.target.value })}/></label>}
      <span className="images-settings-note">保持尺寸 · 原图保留</span>
    </div>
    <div className="images-workspace">
      <div className="images-list">
        <div className="images-list-heading"><label><input aria-label="全选图片" type="checkbox" checked={allSelected} disabled={!!locked || !state.images.length} onChange={e => setSelected(e.target.checked ? state.images.map(i => i.id) : [])}/>文件</label><span>转换结果</span></div>
        {!state.images.length ? <button className="images-empty" disabled={!!locked} onClick={() => files.current?.click()}><Images size={38}/><strong>拖入图片，或点击添加</strong><span>PNG · JPG · WebP · AVIF · TIFF · 静态 GIF</span><small>每张 ≤ 25 MB · 最多 50 张</small></button> : <div className="images-file-rows">{state.images.map(image => {
          const item = job?.items.find(i => i.imageId === image.id);
          return <div key={image.id} className={"images-file-row" + (preview === image.id ? " active" : "")}>
            <input type="checkbox" aria-label={"选择 " + image.name} checked={selected.includes(image.id)} disabled={!!locked} onChange={e => setSelected(old => e.target.checked ? [...old, image.id] : old.filter(id => id !== image.id))}/>
            <button className="images-file-info" onClick={() => setPreview(image.id)} aria-label={"预览 " + image.name}><img src={`/api/images/${image.id}/preview`} alt=""/><span><strong title={image.name}>{image.name}</strong><small>{image.width} × {image.height} · {bytes(image.bytes)}</small></span></button>
            <span className={"images-file-status " + (item?.status ?? "")} title={item?.error ?? item?.outputName}>{item ? statusText[item.status] : "未转换"}{item?.outputBytes !== undefined && <small>{bytes(item.outputBytes)}</small>}</span>
          </div>;
        })}</div>}
      </div>
      <div className="images-preview">
        <div className="images-preview-heading"><h2>原图预览</h2>{active && <span>{active.format.toUpperCase()}{active.alpha ? " · 透明" : ""}</span>}</div>
        <div className="images-preview-canvas">{active ? <img src={`/api/images/${active.id}/preview`} alt={active.name}/> : <Images size={52}/>}</div>
        {active && <div className="images-preview-details"><strong>{active.name}</strong><span>{active.width} × {active.height} · {bytes(active.bytes)}</span>
          {result?.status === "complete" && <div className="images-output-result"><Check size={16}/><span>{result.outputName}<small>{bytes(result.outputBytes!)}</small></span>{native ? <button className="text-button" onClick={() => reveal(active.id)}>定位文件</button> : <a href={`/api/images/jobs/${job!.id}/${active.id}/download`} download>保存图片</a>}</div>}
          {result?.error && <span className="danger">{result.error}</span>}
        </div>}
      </div>
    </div>
    <div className="images-output-bar"><FolderOpen size={18}/><span title={state.outputDirectory}>{state.outputDirectory || "正在读取输出目录…"}</span>
      {native && <><button className="text-button" disabled={!!locked} onClick={() => { setBusy(true); nativeMessage({ action: "image-output-folder" }); }}>选择目录</button><button className="text-button" disabled={!state.outputDirectory || busy} onClick={() => reveal()}>打开文件夹</button></>}
      <small>重名自动编号</small>
    </div>
    <div className="images-footer"><div className="images-progress"><span>{job ? `${statusText[job.status]} · ${completed} / ${job.items.length} 张成功` : "静态图片 · 本地转换"}</span>{job && <progress aria-label="转换进度" max={job.items.length} value={done}/>}</div>
      {working ? <button className="secondary" disabled={stopping} onClick={() => void cancel()}><Square size={15}/>{stopping ? "正在停止…" : "停止转换"}</button> : <button className="primary" disabled={busy || !selected.length} onClick={() => void convert()}><Play size={16}/>开始转换</button>}
    </div>
    {ocr&&<OcrDialog image={ocr} onClose={()=>setOcr(null)}/>}
  </section>;
}
