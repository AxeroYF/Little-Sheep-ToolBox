import { useEffect, useRef, useState } from "react";
import { X, ScanText, Copy, Square } from "lucide-react";
import { api } from "./api";
import type { OcrJob, OcrOptions } from "../shared/ocr";
import "./ocr.css";
export type OcrImage = {
  url: string;
  input?: Blob;
  preview?: string;
  name: string;
  note?: string;
};
export default function OcrDialog({
  image,
  onClose,
}: {
  image: OcrImage;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    alive = useRef(true),
    current = useRef(""),
    controller = useRef<AbortController | null>(null);
  const [options, setOptions] = useState<OcrOptions>({
      language: "chi_sim+eng",
      layout: "auto",
    }),
    [busy, setBusy] = useState(false),
    [stopping, setStopping] = useState(false),
    [available, setAvailable] = useState(false),
    [result, setResult] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    void api<{ available: boolean }>("/ocr/status")
      .then((s) => {
        if (alive.current) {
          setAvailable(s.available);
          if (!s.available) setError("文字识别组件未就绪，请更新工作箱");
        }
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
      controller.current?.abort();
      if (current.current)
        void api("/ocr/" + current.current + "/cancel", {
          method: "POST",
          body: "{}",
        }).catch(() => {});
    };
  }, []);
  async function start() {
    if (busy) return;
    setBusy(true);
    setStopping(false);
    setError("");
    setNotice("");
    setResult("");
    const id = crypto.randomUUID(),
      abort = new AbortController();
    controller.current = abort;
    current.current = id;
    try {
      let body=image.input;
      if(!body){const response = await fetch(image.url, { signal: abort.signal });
        if (!response.ok) throw Error("无法读取图片，请重新选择");
        body = await response.blob();}
      abort.signal.throwIfAborted();
      let job = await api<OcrJob>(
        `/ocr/recognize?id=${id}&language=${encodeURIComponent(options.language)}&layout=${options.layout}`,
        {
          method: "POST",
          body,
          headers: { "Content-Type": "application/octet-stream" },
        },
      );
      // If the dialog was closed during upload, cancel after the server has acknowledged the job.
      if (!alive.current || abort.signal.aborted) {
        await api("/ocr/" + id + "/cancel", {
          method: "POST",
          body: "{}",
        }).catch(() => {});
        return;
      }
      while (job.status === "running") {
        await new Promise<void>((ok) => setTimeout(ok, 300));
        if (!alive.current || abort.signal.aborted) return;
        const next = await api<{ job: OcrJob | null }>("/ocr/status", {
          signal: abort.signal,
        });
        if (next.job?.id !== id) throw Error("识别任务已结束，请重试");
        job = next.job;
      }
      if (alive.current) {
        if (job.status === "complete") {
          setResult(job.text);
          setNotice(
            job.text
              ? `已完成 · ${(job.elapsedMs / 1000).toFixed(1)} 秒`
              : "未识别到文字，试试「单一文本块」或「零散文字」",
          );
        } else if (job.status === "failed")
          throw Error(job.error || "识别失败");
        else setNotice("已停止");
      }
    } catch (e) {
      if (alive.current && !abort.signal.aborted)
        setError(e instanceof Error ? e.message : "识别失败");
    } finally {
      if (alive.current) {
        setBusy(false);
        setStopping(false);
      }
      if (current.current === id) current.current = "";
    }
  }
  async function cancel() {
    if (!current.current) return;
    setStopping(true);
    try {
      await api("/ocr/" + current.current + "/cancel", {
        method: "POST",
        body: "{}",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "停止失败");
      setStopping(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(result);
      setNotice("文字已复制");
    } catch {
      textarea.current?.focus();
      textarea.current?.select();
      setNotice(
        document.execCommand("copy")
          ? "文字已复制"
          : "已选中文字，请按 Ctrl+C 复制",
      );
    }
  }
  return (
    <dialog
      ref={dialog}
      className="ocr-dialog"
      aria-label="文字识别"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <ScanText size={19} />
        <strong>文字识别</strong>
        <span title={image.name}>{image.name}</span>
        <button aria-label="关闭文字识别" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="ocr-controls">
        <label>
          语言
          <select
            aria-label="识别语言"
            value={options.language}
            disabled={busy}
            onChange={(e) =>
              setOptions({
                ...options,
                language: e.target.value as OcrOptions["language"],
              })
            }
          >
            <option value="chi_sim+eng">中文 + 英文</option>
            <option value="chi_sim">中文</option>
            <option value="eng">英文</option>
          </select>
        </label>
        <label>
          版面
          <select
            aria-label="文字版面"
            value={options.layout}
            disabled={busy}
            onChange={(e) =>
              setOptions({
                ...options,
                layout: e.target.value as OcrOptions["layout"],
              })
            }
          >
            <option value="auto">自动</option>
            <option value="block">单一文本块</option>
            <option value="sparse">零散文字</option>
          </select>
        </label>
        <small>{image.note ?? "本机识别"}</small>
      </div>
      {error && (
        <p className="ocr-error" role="alert">
          {error}
        </p>
      )}
      <div className="ocr-content">
        <div className="ocr-image">
          <img src={image.preview ?? image.url} alt="待识别图片" />
        </div>
        <textarea
          ref={textarea}
          aria-label="识别结果"
          placeholder={busy ? "正在识别…" : "识别结果可编辑"}
          value={result}
          onChange={(e) => setResult(e.target.value)}
        />
      </div>
      <footer>
        <span role="status">{busy ? "正在识别…" : notice}</span>
        <button
          className="secondary"
          disabled={!result || busy}
          onClick={() => void copy()}
        >
          <Copy size={14} />
          复制文字
        </button>
        {busy ? (
          <button
            className="secondary"
            disabled={stopping}
            onClick={() => void cancel()}
          >
            <Square size={14} />
            {stopping ? "正在停止…" : "停止"}
          </button>
        ) : (
          <button
            className="primary"
            disabled={!available}
            onClick={() => void start()}
          >
            <ScanText size={14} />
            {result ? "重新识别" : "开始识别"}
          </button>
        )}
      </footer>
    </dialog>
  );
}
