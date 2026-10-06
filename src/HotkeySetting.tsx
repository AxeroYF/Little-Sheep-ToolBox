import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Preferences } from "../shared/types";
import {
  DEFAULT_CAPTURE_HOTKEY,
  captureHotkeyFromEvent,
  displayHotkey,
} from "../shared/hotkey";
import { nativeMessage } from "./App";

type Bridge = {
  addEventListener: (type: string, fn: (e: MessageEvent) => void) => void;
  removeEventListener: (type: string, fn: (e: MessageEvent) => void) => void;
};
const bridge = () =>
  (window as unknown as { chrome?: { webview?: Bridge } }).chrome?.webview;
export function HotkeySetting({
  value,
  available,
  onSaved,
}: {
  value: string;
  available: boolean;
  onSaved: (prefs: Preferences) => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const recorder = useRef<HTMLButtonElement>(null);
  const pending = useRef<{
    id: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const mounted = useRef(true),
    onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  useEffect(() => {
    mounted.current = true;
    const receive = (event: MessageEvent) => {
      if (event.data?.type === "hotkey-recording-cancelled" && !pending.current)
        setEditing(false);
      const request = pending.current;
      if (
        !request ||
        event.data?.type !== "hotkey-saved" ||
        event.data.requestId !== request.id
      )
        return;
      clearTimeout(request.timer);
      pending.current = null;
      setBusy(false);
      if (event.data.error) setError(event.data.error);
      else {
        onSavedRef.current(event.data.preferences);
        setError("");
        setEditing(false);
      }
    };
    const host = bridge();
    host?.addEventListener("message", receive);
    return () => {
      mounted.current = false;
      host?.removeEventListener("message", receive);
      if (pending.current) clearTimeout(pending.current.timer);
    };
  }, []);
  useEffect(() => {
    if (!editing) return;
    nativeMessage({ action: "hotkey-recording", active: true });
    recorder.current?.focus();
    return () => nativeMessage({ action: "hotkey-recording", active: false });
  }, [editing]);
  function record(event: KeyboardEvent<HTMLButtonElement>) {
    if (busy || event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setEditing(false);
      setError("");
      return;
    }
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    const next = captureHotkeyFromEvent(event);
    if (next) {
      setDraft(next);
      setError("");
    } else setError("使用 Ctrl / Alt 组合键、F1–F11 或 PrintScreen");
  }
  function save(next: string) {
    if (busy) return;
    if (!bridge()) {
      setError("请在桌面程序中设置全局快捷键");
      return;
    }
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (mounted.current) {
        pending.current = null;
        setBusy(false);
        setError("保存超时，请重新打开设置确认");
        setEditing(false);
      }
    }, 15000);
    pending.current = { id, timer };
    nativeMessage({ action: "hotkey-save", hotkey: next, requestId: id });
  }
  return (
    <div className="setting-row hotkey-setting">
      <span>截图快捷键</span>
      <div className="hotkey-controls">
        <div className="hotkey-buttons">
          {editing ? (
            <>
              <button
                ref={recorder}
                type="button"
                className="hotkey-recorder"
                aria-label="录制截图快捷键"
                onKeyDown={record}
                disabled={busy}
              >
                {displayHotkey(draft)}
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => save(draft)}
              >
                {busy ? "保存中…" : "保存"}
              </button>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError("");
                }}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <kbd>{displayHotkey(value)}</kbd>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setDraft(value);
                  setError("");
                  setEditing(true);
                }}
              >
                修改
              </button>
              {value !== DEFAULT_CAPTURE_HOTKEY && (
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => save(DEFAULT_CAPTURE_HOTKEY)}
                >
                  恢复默认
                </button>
              )}
            </>
          )}
        </div>
        {(error || !available || editing) && (
          <small
            role={error ? "alert" : "status"}
            className={error || !available ? "danger" : "muted"}
          >
            {error || (editing ? "按下新的快捷键" : "快捷键已被占用，请修改")}
          </small>
        )}
      </div>
    </div>
  );
}
