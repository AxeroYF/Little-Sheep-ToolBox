import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Copy,
  Download,
  FolderOpen,
  Pencil,
  Star,
  Trash2,
  X,
  RotateCcw,
  Search,
  CheckSquare,
} from "lucide-react";
import { api } from "./api";
import { nativeMessage } from "./App";
import type {
  CaptureJob,
  CaptureMode,
  Screenshot,
  ScreenshotStatus,
} from "../shared/screenshots";
import "./screenshots.css";
import OcrDialog,{type OcrImage} from './OcrDialog';
import { displayHotkey } from "../shared/hotkey";
const native = () =>
  (
    window as unknown as {
      chrome?: {
        webview?: {
          addEventListener: (
            type: string,
            fn: (e: MessageEvent) => void,
          ) => void;
          removeEventListener: (
            type: string,
            fn: (e: MessageEvent) => void,
          ) => void;
        };
      };
    }
  ).chrome?.webview;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
export function useScreenshots(
  userId: string | undefined,
  onNotice: (text: string) => void,
  onOpen: () => void,
  captureHotkey: string,
) {
  const [status, setStatus] = useState<ScreenshotStatus | null>(null),
    [pending, setPending] = useState(false),
    [hotkey, setHotkey] = useState(true);
  const tracking = useRef<string | null>(null),
    requesting = useRef(false);
  const handlers = useRef({ onNotice, onOpen });
  handlers.current = { onNotice, onOpen };
  useEffect(() => {
    let live = true;
    tracking.current = null;
    requesting.current = false;
    setPending(false);
    setStatus(null);
    if (!userId) return;
    const finish = (job: CaptureJob) => {
      if (
        job.id !== tracking.current ||
        ["starting", "running"].includes(job.status)
      )
        return;
      tracking.current = null;
      requesting.current = false;
      setPending(false);
      const success = job.status === "complete";
      nativeMessage({ action: "capture-finished", success });
      handlers.current.onNotice(
        success
          ? "截图已保存"
          : job.status === "failed"
            ? job.error
            : "已取消截图",
      );
    };
    const refresh = async () => {
      try {
        const s = await api<ScreenshotStatus>("/screenshots/status");
        if (live) {
          setStatus(s);
          if (s.job) finish(s.job);
        }
      } catch {}
    };
    const begin = async (mode: CaptureMode, parentId?: string) => {
      if (requesting.current) return;
      requesting.current = true;
      setPending(true);
      try {
        const job = await api<CaptureJob>("/screenshots/capture", {
          method: "POST",
          body: JSON.stringify({ mode, parentId: parentId || undefined }),
        });
        if (live) {
          tracking.current = job.id;
          finish(job);
          await refresh();
        }
      } catch (e) {
        if (live) {
          setPending(false);
          requesting.current = false;
          nativeMessage({ action: "capture-finished", success: false });
          handlers.current.onNotice(errorText(e));
        }
      }
    };
    const receive = (event: MessageEvent) => {
      if (!live) return;
      const m = event.data;
      if (m?.type === "capture-request") void begin(m.mode, m.parentId);
      if (m?.type === "hotkey-status") setHotkey(!!m.available);
      if (m?.type === "open-screenshots") handlers.current.onOpen();
      if (m?.type === "native-error" || m?.type === "native-done")
        handlers.current.onNotice(m.message);
    };
    const browserCapture = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      void begin(detail.mode, detail.parentId);
    };
    native()?.addEventListener("message", receive);
    window.addEventListener("workbox:capture", browserCapture);
    // Prepare after login while the user is choosing an app, not on the first keypress.
    void api("/screenshots/warmup", { method: "POST", body: "{}" }).catch(
      () => {},
    );
    void refresh();
    const timer = setInterval(() => void refresh(), 1200);
    return () => {
      live = false;
      clearInterval(timer);
      native()?.removeEventListener("message", receive);
      window.removeEventListener("workbox:capture", browserCapture);
    };
  }, [userId]);
  function capture(mode: CaptureMode, parentId?: string) {
    if (pending) return;
    if (native()) nativeMessage({ action: "capture", mode, parentId });
    else
      window.dispatchEvent(
        new CustomEvent("workbox:capture", { detail: { mode, parentId } }),
      );
  }
  return {
    status,
    pending,
    hotkey,
    capture,
    hotkeyLabel: displayHotkey(captureHotkey),
  };
}
type Controller = ReturnType<typeof useScreenshots>;
type Listing = { images: Screenshot[]; total: number; categories: string[] };
export function ScreenshotsPanel({
  controller,
  notice,
}: {
  controller: Controller;
  notice: (text: string) => void;
}) {
  const [view, setView] = useState("all"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [offset, setOffset] = useState(0);
  const [listing, setListing] = useState<Listing>({
      images: [],
      total: 0,
      categories: [],
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState<Screenshot | null>(null),
    [batchCategory, setBatchCategory] = useState("");
  const [mode, setMode] = useState<CaptureMode>("region");
  const [ocr,setOcr]=useState<OcrImage|null>(null);
  const recognize=(shot:Screenshot)=>{setMenu(null);setPreview(null);setOcr({url:`/api/screenshots/${shot.id}/image`,name:shot.title})};
  const [menu, setMenu] = useState<{
    shot: Screenshot;
    ids: string[];
    x: number;
    y: number;
  } | null>(null);
  const [renaming, setRenaming] = useState<Screenshot | null>(null),
    [newName, setNewName] = useState(""),
    [renameBusy, setRenameBusy] = useState(false),
    [renameError, setRenameError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null),
    renameDialog = useRef<HTMLDialogElement>(null),
    renameInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setOffset(0);
    setSelected([]);
  }, [view, query, category]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        void api<Listing>(
          "/screenshots?" +
            new URLSearchParams({
              view,
              query,
              category,
              offset: String(offset),
            }),
        )
          .then((data) => {
            if (live) setListing(data);
          })
          .catch((e) => {
            if (live) setError(errorText(e));
          })
          .finally(() => {
            if (live) setLoading(false);
          }),
      120,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    view,
    query,
    category,
    offset,
    revision,
    controller.status?.job?.imageId,
  ]);
  useEffect(() => {
    if (preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [preview?.id]);
  useEffect(() => {
    if (renaming) {
      renameDialog.current?.showModal();
      renameInput.current?.focus();
      renameInput.current?.select();
    } else renameDialog.current?.close();
  }, [renaming?.id]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const dismiss = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);
  async function patch(
    ids: string[],
    data: Partial<Screenshot> & { trash?: boolean },
  ) {
    try {
      await api("/screenshots", {
        method: "PATCH",
        body: JSON.stringify({ ids, ...data }),
      });
      setRevision((x) => x + 1);
      setSelected([]);
      if (preview && ids.includes(preview.id)) {
        if (data.trash !== undefined) setPreview(null);
        else setPreview({ ...preview, ...data });
      }
      return true;
    } catch (e) {
      notice(errorText(e));
      return false;
    }
  }
  function file(operation: string, ids: string[]) {
    if (!native()) {
      notice("请在小羊工作箱桌面程序中操作");
      return;
    }
    nativeMessage({ action: "screenshot-file", operation, ids });
  }
  const busy = controller.pending;
  const single =
    selected.length === 1
      ? listing.images.find((s) => s.id === selected[0])
      : undefined;
  function rename(shot: Screenshot) {
    setPreview(null);
    setMenu(null);
    setNewName(shot.title);
    setRenameError("");
    setRenaming(shot);
  }
  const menuAction = (action: () => void) => {
    setMenu(null);
    action();
  };
  return (
    <section className="shots-panel">
      <div className="shots-toolbar">
        <div className="shot-capture">
          <button
            className="primary"
            disabled={busy || !controller.status?.available}
            onClick={() => controller.capture(mode)}
          >
            <Camera size={17} />
            {busy ? "截图中…" : "截图"}
          </button>
          <select
            aria-label="截图方式"
            value={mode}
            onChange={(e) => setMode(e.target.value as CaptureMode)}
          >
            <option value="region">区域</option>
            <option value="window">窗口</option>
            <option value="screen">全屏</option>
          </select>
        </div>
        {busy ? (
          <button
            className="secondary"
            onClick={() =>
              void api("/screenshots/cancel", {
                method: "POST",
                body: "{}",
              }).catch((e) => notice(errorText(e)))
            }
          >
            取消
          </button>
        ) : (
          <span className="muted shot-shortcut">
            {controller.hotkey ? controller.hotkeyLabel : "快捷键已被占用"}
          </span>
        )}
        <label className="search">
          <Search size={16} />
          <input
            aria-label="搜索截图"
            placeholder="搜索截图"
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="shots-filters">
        <div className="segments">
          {[
            ["all", "全部"],
            ["favorites", "收藏"],
            ["trash", "回收站"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={view === key ? "selected" : ""}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="筛选分类"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">全部分类</option>
          {listing.categories.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <span className="muted">{listing.total} 张</span>
        {!!listing.images.length && (
          <button
            className="quiet"
            onClick={() =>
              setSelected(
                selected.length === listing.images.length
                  ? []
                  : listing.images.map((s) => s.id),
              )
            }
          >
            <CheckSquare size={16} />
            {selected.length === listing.images.length
              ? "取消选择"
              : "选择本页"}
          </button>
        )}
      </div>
      <div className="shots-selection" role="toolbar" aria-label="截图管理">
        <button className="secondary" disabled={!single||!!single.deletedAt} onClick={()=>single&&recognize(single)}>文字识别</button>
        <span className="muted shots-selection-count">
          已选 {selected.length} 张
        </span>
        <button
          className="secondary"
          disabled={!single}
          onClick={() => file("copy", selected)}
        >
          <Copy size={15} />
          复制
        </button>
        <button
          className="secondary"
          disabled={!single}
          onClick={() => single && rename(single)}
        >
          <Pencil size={15} />
          重命名
        </button>
        <button
          className="secondary"
          disabled={!single}
          onClick={() => file("reveal", selected)}
        >
          <FolderOpen size={15} />
          文件夹
        </button>
        <button
          className="secondary"
          disabled={!selected.length}
          onClick={() => file("export", selected)}
        >
          <Download size={15} />
          导出
        </button>
        {view === "trash" ? (
          <button
            className="secondary"
            disabled={!selected.length}
            onClick={() => void patch(selected, { trash: false })}
          >
            <RotateCcw size={15} />
            恢复
          </button>
        ) : (
          <>
            <button
              className="secondary"
              disabled={!selected.length}
              onClick={() => void patch(selected, { favorite: true })}
            >
              <Star size={15} />
              收藏
            </button>
            <button
              className="secondary"
              disabled={!single || busy}
              onClick={() => single && controller.capture("edit", single.id)}
            >
              编辑
            </button>
            <button
              className="quiet danger"
              disabled={!selected.length}
              onClick={() => void patch(selected, { trash: true })}
            >
              <Trash2 size={16} />
              删除
            </button>
          </>
        )}
        <div className="shots-category-action">
          <input
            aria-label="批量分类"
            placeholder="分类"
            value={batchCategory}
            maxLength={40}
            onChange={(e) => setBatchCategory(e.target.value)}
            list="shot-categories"
          />
          <button
            className="secondary"
            disabled={!selected.length}
            onClick={() => void patch(selected, { category: batchCategory })}
          >
            归类
          </button>
        </div>
      </div>
      {error ? (
        <div className="empty-state">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => setRevision((x) => x + 1)}
          >
            重试
          </button>
        </div>
      ) : loading ? (
        <div className="empty-state">正在加载…</div>
      ) : !listing.images.length ? (
        <div className="shots-empty">
          <Camera size={40} />
          <h2>
            {view === "trash"
              ? "回收站为空"
              : query || category
                ? "没有找到截图"
                : "暂无截图"}
          </h2>
          {view === "all" && !query && !category && (
            <button
              className="secondary"
              disabled={!controller.status?.available || busy}
              onClick={() => controller.capture("region")}
            >
              开始截图
            </button>
          )}
        </div>
      ) : (
        <div className="shots-grid">
          {listing.images.map((shot) => (
            <article
              className={
                "shot-card" + (selected.includes(shot.id) ? " selected" : "")
              }
              key={shot.id}
              onContextMenu={(e) => {
                e.preventDefault();
                const ids = selected.includes(shot.id) ? selected : [shot.id];
                setSelected(ids);
                setMenu({
                  shot,
                  ids,
                  x: Math.max(8, Math.min(e.clientX, window.innerWidth - 220)),
                  y: Math.max(8, Math.min(e.clientY, window.innerHeight - 380)),
                });
              }}
            >
              <button
                className="shot-thumbnail"
                aria-label={"预览 " + shot.title}
                onClick={() => setPreview(shot)}
              >
                <img
                  loading="lazy"
                  src={`/api/screenshots/${shot.id}/thumbnail`}
                  alt={shot.title}
                />
              </button>
              <label className="shot-select">
                <input
                  type="checkbox"
                  aria-label={"选择 " + shot.title}
                  checked={selected.includes(shot.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, shot.id]
                        : old.filter((id) => id !== shot.id),
                    )
                  }
                />
              </label>
              <div className="shot-card-info">
                <strong title={shot.title}>{shot.title}</strong>
                <div>
                  <small>
                    {shot.category ||
                      new Date(shot.createdAt).toLocaleDateString()}{" "}
                    · {shot.width} × {shot.height}
                  </small>
                  <button
                    className={
                      "icon-button " + (shot.favorite ? "is-favorite" : "")
                    }
                    title={shot.favorite ? "取消收藏" : "收藏截图"}
                    aria-label={
                      (shot.favorite ? "取消收藏 " : "收藏 ") + shot.title
                    }
                    onClick={() =>
                      void patch([shot.id], { favorite: !shot.favorite })
                    }
                  >
                    <Star size={17} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {listing.total > 60 && (
        <div className="shots-pagination">
          <button
            className="secondary"
            disabled={!offset}
            onClick={() => {
              setOffset((x) => Math.max(0, x - 60));
              setSelected([]);
            }}
          >
            上一页
          </button>
          <span>
            {Math.floor(offset / 60) + 1} / {Math.ceil(listing.total / 60)}
          </span>
          <button
            className="secondary"
            disabled={offset + 60 >= listing.total}
            onClick={() => {
              setOffset((x) => x + 60);
              setSelected([]);
            }}
          >
            下一页
          </button>
        </div>
      )}
      {controller.status && !controller.status.available && (
        <p className="shot-component-status">ShareX 组件未就绪</p>
      )}
      <datalist id="shot-categories">
        {listing.categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {menu && (
        <div
          ref={menuRef}
          className="shot-context-menu"
          role="menu"
          aria-label="截图操作"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(e.key))
              return;
            e.preventDefault();
            const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ) ?? [],
              ),
              index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : (index + (e.key === "ArrowUp" ? -1 : 1) + items.length) %
                    items.length;
            items[next]?.focus();
          }}
        >
          <button
            role="menuitem"
            disabled={menu.ids.length !== 1}
            onClick={() => menuAction(() => setPreview(menu.shot))}
          >
            预览
          </button>
          <button role="menuitem" disabled={menu.ids.length!==1||!!menu.shot.deletedAt} onClick={()=>recognize(menu.shot)}>文字识别</button>
          <button
            role="menuitem"
            disabled={menu.ids.length !== 1}
            onClick={() => menuAction(() => file("copy", menu.ids))}
          >
            复制图片
          </button>
          <button
            role="menuitem"
            disabled={menu.ids.length !== 1}
            onClick={() => rename(menu.shot)}
          >
            重命名
          </button>
          <button
            role="menuitem"
            disabled={menu.ids.length !== 1}
            onClick={() => menuAction(() => file("reveal", menu.ids))}
          >
            打开源文件夹
          </button>
          <button
            role="menuitem"
            onClick={() =>
              menuAction(() =>
                file(menu.ids.length === 1 ? "save" : "export", menu.ids),
              )
            }
          >
            {menu.ids.length === 1 ? "另存为" : "导出所选"}
          </button>
          {!menu.shot.deletedAt && (
            <>
              <button
                role="menuitem"
                disabled={menu.ids.length !== 1 || busy}
                onClick={() =>
                  menuAction(() => controller.capture("edit", menu.shot.id))
                }
              >
                编辑
              </button>
              <button
                role="menuitem"
                onClick={() =>
                  menuAction(
                    () =>
                      void patch(menu.ids, { favorite: !menu.shot.favorite }),
                  )
                }
              >
                {menu.shot.favorite ? "取消收藏" : "收藏"}
              </button>
            </>
          )}
          <div className="shot-menu-divider" />
          <button
            role="menuitem"
            className={menu.shot.deletedAt ? "" : "danger"}
            onClick={() =>
              menuAction(
                () => void patch(menu.ids, { trash: !menu.shot.deletedAt }),
              )
            }
          >
            {menu.shot.deletedAt ? "恢复" : "移到回收站"}
          </button>
        </div>
      )}
      <dialog
        ref={renameDialog}
        className="shot-rename"
        onCancel={() => !renameBusy && setRenaming(null)}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!renaming || !newName.trim() || renameBusy) return;
            setRenameBusy(true);
            const ok = await patch([renaming.id], { title: newName.trim() });
            setRenameBusy(false);
            if (ok) setRenaming(null);
            else setRenameError("重命名失败，请重试");
          }}
        >
          <h2>重命名</h2>
          <input
            ref={renameInput}
            aria-label="新截图名称"
            value={newName}
            maxLength={100}
            required
            onChange={(e) => setNewName(e.target.value)}
          />
          {renameError && (
            <p role="alert" className="danger">
              {renameError}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="secondary"
              disabled={renameBusy}
              onClick={() => setRenaming(null)}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={renameBusy || !newName.trim()}
            >
              {renameBusy ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        className="shot-preview"
        ref={dialog}
        onCancel={() => setPreview(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setPreview(null);
        }}
      >
        {preview && (
          <>
            <div className="shot-preview-header">
              <input
                aria-label="截图名称"
                key={preview.id}
                defaultValue={preview.title}
                maxLength={100}
                onBlur={(e) => {
                  const title = e.target.value.trim();
                  if (title && title !== preview.title)
                    void patch([preview.id], { title });
                }}
              />
              <button
                className="icon-button"
                aria-label="关闭预览"
                onClick={() => setPreview(null)}
                autoFocus
              >
                <X size={21} />
              </button>
            </div>
            <div className="shot-preview-image">
              <img
                src={`/api/screenshots/${preview.id}/image`}
                alt={preview.title}
              />
            </div>
            <div className="shot-preview-actions">
              <small>
                {preview.width} × {preview.height} ·{" "}
                {(preview.bytes / 1024).toFixed(0)} KB
                {preview.parentId ? " · 编辑版本" : ""}
              </small>
              <input
                aria-label="截图分类"
                placeholder="分类"
                list="shot-categories"
                key={preview.id + "category"}
                defaultValue={preview.category}
                maxLength={40}
                onBlur={(e) => {
                  if (e.target.value !== preview.category)
                    void patch([preview.id], { category: e.target.value });
                }}
              />
              <button
                className="icon-button"
                title="复制图片"
                aria-label="复制图片"
                onClick={() => file("copy", [preview.id])}
              >
                <Copy size={19} />
              </button>
              <button
                className="icon-button"
                title="另存为"
                aria-label="另存为"
                onClick={() => file("save", [preview.id])}
              >
                <Download size={19} />
              </button>
              <button
                className="icon-button"
                title="打开所在文件夹"
                aria-label="打开所在文件夹"
                onClick={() => file("reveal", [preview.id])}
              >
                <FolderOpen size={19} />
              </button>
              {preview.deletedAt ? (
                <button
                  className="secondary"
                  onClick={() => void patch([preview.id], { trash: false })}
                >
                  <RotateCcw size={16} />
                  恢复
                </button>
              ) : (
                <>
                  <button
                    className="secondary"
                    disabled={busy || !controller.status?.available}
                    onClick={() => {
                      controller.capture("edit", preview.id);
                      setPreview(null);
                    }}
                  >
                    <Pencil size={16} />
                    编辑
                  </button>
                  <button
                    className="icon-button danger"
                    title="移到回收站"
                    aria-label="移到回收站"
                    onClick={() => void patch([preview.id], { trash: true })}
                  >
                    <Trash2 size={18} />
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </dialog>
      {ocr&&<OcrDialog image={ocr} onClose={()=>setOcr(null)}/>}
    </section>
  );
}
