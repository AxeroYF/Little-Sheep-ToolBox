import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import {
  Grid2X2,
  Star,
  Clock3,
  Settings2,
  LogOut,
  Search,
  Sun,
  Moon,
  Monitor,
  ArrowUpRight,
  Dog,
  Activity,
  UserRound,
  Camera,
  Crown,
  House,
  Images,
  Cpu,
  RefreshCw,
  Film,
} from "lucide-react";
import type {
  User,
  Tool,
  Preferences,
  Theme,
  Capabilities,
} from "../shared/types";
import { api, desktop } from "./api";
import { NetworkPanel } from "./NetworkPanel";
import { ScreenshotsPanel, useScreenshots } from "./ScreenshotsPanel";
import { HotkeySetting } from "./HotkeySetting";
import { DEFAULT_CAPTURE_HOTKEY } from "../shared/hotkey";

export function nativeMessage(message: unknown) {
  (
    window as unknown as {
      chrome?: { webview?: { postMessage: (m: unknown) => void } };
    }
  ).chrome?.webview?.postMessage(message);
}
export function SheepMark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M12 31c-8-1-9-13-2-16-2-9 10-13 15-7 6-6 18 0 15 8 9 5 4 17-4 17H12Z"
        fill="currentColor"
      />
      <path d="M18 22c0-8 16-8 16 0v9c0 10-16 10-16 0v-9Z" fill="var(--blue)" />
      <path
        d="m18 23-6-4m22 4 5-4"
        stroke="var(--blue)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M22 28v2m8-2v2"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
const defaults: Preferences = { favorites: [], recent: [], theme: "system" };
const RoomPanel = lazy(() => import("./RoomPanel"));
const ImagesPanel = lazy(() => import("./ImageWorkshop"));
const ComputerPanel = lazy(() => import("./ComputerPanel"));
const VideoPanel = lazy(() => import("./VideoPanel"));
const networkWindow =
  new URLSearchParams(location.search).get("window") === "network";
const roomWindow =
  new URLSearchParams(location.search).get("window") === "room";
const imageWindow =
  new URLSearchParams(location.search).get("window") === "images";
const computerWindow =
  new URLSearchParams(location.search).get("window") === "computer";
const videoWindow = new URLSearchParams(location.search).get("window") === "video";
const toolWindow = networkWindow || roomWindow || imageWindow || computerWindow || videoWindow;
const windowTitle = videoWindow ? "小羊视频播放器" : computerWindow
  ? "小羊电脑信息"
  : imageWindow
    ? "小羊图片工坊"
    : roomWindow
      ? "小羊房间设计"
      : networkWindow
        ? "小羊网络测试"
        : "小羊工作箱";
const errorText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  const [cap, setCap] = useState<Capabilities | null>(null),
    [tools, setTools] = useState<Tool[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(defaults),
    [theme, setTheme] = useState<Theme>("system");
  const [page, setPage] = useState("all"),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState(""),
    [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  async function refreshApps() {
    setRefreshing(true);
    try {
      setTools((await api<{ apps: Tool[] }>("/apps")).apps);
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }
  const captureHotkey = prefs.captureHotkey ?? DEFAULT_CAPTURE_HOTKEY;
  const screenshots = useScreenshots(
    toolWindow ? undefined : user?.id,
    setNotice,
    () => setPage("screenshots"),
    captureHotkey,
  );
  useEffect(() => {
    nativeMessage({
      action: "hostSettings",
      signedIn: !!user,
      closeToTray: !!prefs.closeToTray,
      captureHotkey,
      minimizeOnCapture: prefs.minimizeOnCapture !== false,
    });
  }, [user?.id, prefs.closeToTray, captureHotkey, prefs.minimizeOnCapture]);
  const locked = () => {
    setUser(null);
    setTools([]);
    setPrefs(defaults);
    setPage("all");
    setNotice("");
  };
  useEffect(() => {
    document.title = windowTitle;
    Promise.all([
      api<{ user: User | null }>("/session"),
      desktop.capabilities(),
    ])
      .then(([s, c]) => {
        setUser(s.user);
        setCap(c);
      })
      .catch((e) => setFatal(errorText(e)))
      .finally(() => setReady(true));
    const expired = () => locked();
    window.addEventListener("workbox:unauthorized", expired);
    return () => window.removeEventListener("workbox:unauthorized", expired);
  }, []);
  useEffect(() => {
    let live = true;
    if (user)
      Promise.all([
        api<{ apps: Tool[] }>("/apps"),
        api<Preferences>("/preferences"),
      ])
        .then(([a, p]) => {
          if (live) {
            setTools(a.apps);
            setPrefs(p);
            setTheme(p.theme);
          }
        })
        .catch((e) => {
          if (live) setNotice(errorText(e));
        });
    const check = () => {
      void api<{ user: User | null }>("/session")
        .then((s) => {
          if (live && s.user?.id !== user?.id) {
            setTools([]);
            setPrefs(defaults);
            setPage("all");
            setQuery("");
            setNotice("");
            setUser(s.user);
          }
        })
        .catch(() => {});
    };
    window.addEventListener("focus", check);
    const timer = setInterval(check, 2000);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!user || toolWindow) return;
    let live = true;
    const refresh = () => {
      if (!document.hidden)
        void api<{ apps: Tool[] }>("/apps")
          .then((a) => {
            if (live) setTools(a.apps);
          })
          .catch(() => {});
    };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 2500);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user?.id]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const value =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = value;
      nativeMessage({ action: "theme", theme: value });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function update(data: Partial<Preferences>) {
    try {
      const p = await api<Preferences>("/preferences", {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      setPrefs(p);
      setTheme(p.theme);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  function chooseTheme(value: Theme) {
    setTheme(value);
    if (user) void update({ theme: value });
  }
  async function logout() {
    try {
      if (roomWindow) {
        const detail = { pending: Promise.resolve() };
        window.dispatchEvent(new CustomEvent("room-before-logout", { detail }));
        await detail.pending;
      }
      if (imageWindow) {
        const detail = { pending: Promise.resolve() };
        window.dispatchEvent(new CustomEvent("photo-before-leave", { detail }));
        await detail.pending;
      }
      await api("/auth/logout", { method: "POST", body: "{}" });
      locked();
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function launch(tool: Tool) {
    setBusy(tool.id);
    try {
      const result = await desktop.launch(tool.id);
      if (result.page) {
        setPage(result.page);
        setQuery("");
      }
      setPrefs(await api<Preferences>("/preferences"));
      await refreshApps();
      if (!result.page) setNotice("已打开 " + tool.name);
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function closeApp(tool: Tool) {
    setBusy(tool.id);
    try {
      await api("/apps/" + encodeURIComponent(tool.id) + "/close", {
        method: "POST",
        body: "{}",
      });
      setNotice("已请求退出 " + tool.name + "，如有保存提示请在应用中处理");
      await refreshApps();
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy("");
    }
  }
  const themeControl = (
    <div className="segments theme-control" aria-label="外观">
      {(
        [
          ["light", Sun, "浅色"],
          ["dark", Moon, "深色"],
          ["system", Monitor, "跟随系统"],
        ] as const
      ).map(([value, Icon, label]) => (
        <button
          key={value}
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          className={theme === value ? "selected" : ""}
          onClick={() => chooseTheme(value)}
        >
          <Icon size={17} />
        </button>
      ))}
    </div>
  );
  if (!ready || fatal)
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-icon">
            <SheepMark />
          </div>
          <h1>小羊工作箱</h1>
          <p role="status">{fatal || "正在打开…"}</p>
          {fatal && (
            <button className="primary" onClick={() => location.reload()}>
              重试
            </button>
          )}
        </div>
      </div>
    );
  if (!user)
    return (
      <div className="auth-screen">
        <div className="auth-theme">{themeControl}</div>
        <Auth onSuccess={setUser} />
      </div>
    );
  const titles: Record<string, string> = {
    all: "全部应用",
    favorites: "收藏",
    recent: "最近使用",
    settings: "设置",
    account: "账号",
    screenshots: "截图",
  };
  const list = tools
    .filter(
      (t) =>
        (page !== "favorites" || prefs.favorites.includes(t.id)) &&
        (page !== "recent" || prefs.recent.some((r) => r.id === t.id)) &&
        t.name.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      page === "recent"
        ? prefs.recent.findIndex((r) => r.id === a.id) -
          prefs.recent.findIndex((r) => r.id === b.id)
        : 0,
    );
  return (
    <div className={toolWindow ? "desktop network-desktop" : "desktop"}>
      {!toolWindow && (
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-icon">
              <SheepMark />
            </div>
            <strong>小羊工作箱</strong>
            <span className="version">0.2</span>
          </div>
          <button className="profile" onClick={() => setPage("account")}>
            <span className="avatar">{user.displayName.slice(0, 1)}</span>
            <span>
              <strong>{user.displayName}</strong>
              <small>@{user.username}</small>
            </span>
            <UserRound size={17} />
          </button>
          <nav>
            {(
              [
                ["all", Grid2X2],
                ["favorites", Star],
                ["recent", Clock3],
                ["screenshots", Camera],
                ["settings", Settings2],
              ] as const
            ).map(([id, Icon]) => (
              <button
                className={page === id ? "nav-item active" : "nav-item"}
                key={id}
                onClick={() => {
                  setPage(id);
                  setQuery("");
                }}
              >
                <Icon size={21} />
                <span>{titles[id]}</span>
                {id === "all" && <b>{tools.length}</b>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            {themeControl}
            <button className="quiet logout" onClick={logout}>
              <LogOut size={17} />
              退出登录
            </button>
          </div>
        </aside>
      )}
      <main className="workspace">
        <header className="topbar">
          <h1>{toolWindow ? windowTitle : titles[page]}</h1>
          {toolWindow ? (
            <div className="row">
              {themeControl}
              <button
                className="icon-button"
                title="退出登录"
                aria-label="退出登录"
                onClick={logout}
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : ["all", "favorites", "recent"].includes(page) ? (
            <label className="search">
              <Search size={17} />
              <input
                placeholder="搜索应用"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          ) : (
            <span className="muted">{user.displayName}</span>
          )}
        </header>
        {videoWindow ? (
          <Suspense fallback={<div className="room-loading">正在打开…</div>}><VideoPanel key={user.id}/></Suspense>
        ) : computerWindow ? (
          <Suspense fallback={<div className="room-loading">正在打开…</div>}>
            <ComputerPanel key={user.id} />
          </Suspense>
        ) : imageWindow ? (
          <Suspense fallback={<div className="room-loading">正在打开…</div>}>
            <ImagesPanel key={user.id} />
          </Suspense>
        ) : roomWindow ? (
          <Suspense fallback={<div className="room-loading">正在打开…</div>}>
            <RoomPanel key={user.id} />
          </Suspense>
        ) : networkWindow ? (
          <NetworkPanel key={user.id} />
        ) : (
          <div className="page-content">
            {page === "screenshots" ? (
              <ScreenshotsPanel
                key={user.id}
                controller={screenshots}
                notice={setNotice}
              />
            ) : ["all", "favorites", "recent"].includes(page) ? (
              <>
                <div className="section-line">
                  <span>Windows</span>
                  <span className="app-catalog-actions">
                    {list.length} 个应用{" "}
                    <button
                      className="icon-button"
                      aria-label="刷新应用"
                      title="刷新应用"
                      disabled={refreshing}
                      onClick={refreshApps}
                    >
                      <RefreshCw size={15} />
                    </button>
                  </span>
                </div>
                <div className="app-grid">
                  {list.map((tool) => (
                    <article className="app-card" key={tool.id}>
                      <div className="app-card-top">
                        <div
                          className={
                            "tool-icon " +
                            (tool.id === "yellow-dogs" ? "amber" : "blue")
                          }
                        >
                          {tool.id === "yellow-dogs" ? (
                            <Dog size={31} />
                          ) : tool.id === "sharex" ? (
                            <Camera size={31} />
                          ) : tool.id === "xiaoyang-chess" ? (
                            <Crown size={31} />
                          ) : tool.id === "xiaoyang-room" ? (
                            <House size={31} />
                          ) : tool.id === "xiaoyang-images" ? (
                            <Images size={31} />
                          ) : tool.id === "xiaoyang-computer" ? (
                            <Cpu size={31} />
                          ) : tool.id === "xiaoyang-video" ? (
                            <Film size={31} />
                          ) : (
                            <Activity size={31} />
                          )}
                        </div>
                        <button
                          className={
                            "icon-button favorite " +
                            (prefs.favorites.includes(tool.id)
                              ? "is-favorite"
                              : "")
                          }
                          aria-label={
                            (prefs.favorites.includes(tool.id)
                              ? "取消收藏"
                              : "收藏") + tool.name
                          }
                          onClick={() =>
                            update({
                              favorites: prefs.favorites.includes(tool.id)
                                ? prefs.favorites.filter((id) => id !== tool.id)
                                : [...prefs.favorites, tool.id],
                            })
                          }
                        >
                          <Star size={19} />
                        </button>
                      </div>
                      <h2>{tool.name}</h2>
                      <div className="tool-meta">
                        <span>{tool.category}</span>
                        <span>
                          {[
                            "xiaoyang-network",
                            "xiaoyang-chess",
                            "xiaoyang-room",
                            "xiaoyang-images",
                            "xiaoyang-computer",
                          ].includes(tool.id)
                            ? "原创"
                            : tool.integration === "managed"
                              ? "已接入"
                              : "外部应用"}
                        </span>
                      </div>
                      <div className="app-card-bottom">
                        <span
                          className={
                            tool.runtime?.state === "running"
                              ? "app-running"
                              : tool.installed
                                ? "installed"
                                : "muted"
                          }
                        >
                          {tool.runtime?.state === "running"
                            ? "● 运行中"
                            : tool.runtime?.state === "starting"
                              ? "启动中…"
                              : tool.runtime?.state === "closing"
                                ? "正在退出…"
                                : !tool.installed
                                  ? "未找到程序"
                                  : tool.runtime?.state === "unknown"
                                    ? "状态未知"
                                    : tool.runtime?.state === "embedded"
                                      ? "内嵌工具"
                                      : "已就绪"}
                        </span>
                        <button
                          className={
                            "primary app-launch" +
                            (tool.runtime?.state === "running"
                              ? " running"
                              : "")
                          }
                          aria-label={
                            (tool.runtime?.state === "running"
                              ? "结束运行"
                              : "开始") + tool.name
                          }
                          title={
                            tool.runtime?.state === "running" &&
                            !tool.runtime.canClose
                              ? "旧版应用请先从托盘退出，再重开以支持统一结束运行"
                              : undefined
                          }
                          disabled={
                            !tool.launchable ||
                            !!busy ||
                            tool.runtime?.state === "starting" ||
                            tool.runtime?.state === "closing" ||
                            (tool.runtime?.state === "running" &&
                              !tool.runtime.canClose)
                          }
                          onClick={() =>
                            tool.runtime?.state === "running"
                              ? void closeApp(tool)
                              : void launch(tool)
                          }
                        >
                          {busy === tool.id ? (
                            "处理中…"
                          ) : tool.runtime?.state === "starting" ? (
                            "启动中…"
                          ) : tool.runtime?.state === "closing" ? (
                            "正在退出…"
                          ) : tool.runtime?.state === "running" ? (
                            <>
                              <span className="app-running-label">运行中</span>
                              <span className="app-end-label">结束运行</span>
                            </>
                          ) : (
                            "开始"
                          )}
                          {tool.runtime?.state !== "running" && (
                            <ArrowUpRight size={16} />
                          )}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {list.length === 0 && (
                  <div className="empty">
                    {query ? "没有匹配的应用" : "暂无应用"}
                  </div>
                )}
              </>
            ) : page === "settings" ? (
              <section className="settings-panel">
                <div className="setting-row">
                  <span>外观</span>
                  {themeControl}
                </div>
                <div className="setting-row">
                  <span>版本</span>
                  <span className="muted">{cap?.version}</span>
                </div>
                <div className="setting-row">
                  <label htmlFor="close-to-tray">关闭时收进系统托盘</label>
                  <input
                    id="close-to-tray"
                    className="setting-switch"
                    type="checkbox"
                    role="switch"
                    checked={!!prefs.closeToTray}
                    onChange={(e) =>
                      void update({ closeToTray: e.target.checked })
                    }
                  />
                </div>
                <HotkeySetting
                  key={user.id}
                  value={captureHotkey}
                  available={screenshots.hotkey}
                  onSaved={setPrefs}
                />
                <div className="setting-row">
                  <label htmlFor="minimize-on-capture">截图时折叠主界面</label>
                  <input
                    id="minimize-on-capture"
                    className="setting-switch"
                    type="checkbox"
                    role="switch"
                    checked={prefs.minimizeOnCapture !== false}
                    onChange={(e) =>
                      void update({ minimizeOnCapture: e.target.checked })
                    }
                  />
                </div>
                <div className="setting-row">
                  <span>截图组件</span>
                  <span className="muted">ShareX 21.0.0 · 仅本地保存</span>
                </div>
              </section>
            ) : (
              <section className="settings-panel">
                <div className="setting-row">
                  <span>昵称</span>
                  <strong>{user.displayName}</strong>
                </div>
                <div className="setting-row">
                  <span>账号</span>
                  <span>{user.username}</span>
                </div>
                <div className="setting-row">
                  <span>账号范围</span>
                  <span className="muted">本机</span>
                </div>
                <div className="setting-row">
                  <span>创建日期</span>
                  <span className="muted">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button className="secondary" onClick={logout}>
                  退出登录
                </button>
              </section>
            )}
          </div>
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
function Auth({ onSuccess }: { onSuccess: (u: User) => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const result = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      onSuccess(result.user);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <div className="brand-icon large">
        <SheepMark />
      </div>
      <h1>{windowTitle}</h1>
      <form onSubmit={submit}>
        <label>
          账号
          <input
            name="username"
            required
            maxLength={24}
            defaultValue="小羊"
            autoComplete="username"
            placeholder="输入账号"
          />
        </label>
        <label>
          密码
          <input
            name="password"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            placeholder="输入密码"
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="primary auth-submit" disabled={busy}>
          {busy ? "请稍候…" : "登录"}
        </button>
      </form>
    </section>
  );
}
