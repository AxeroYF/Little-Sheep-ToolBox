import type { Capabilities, DesktopAdapter } from "../shared/types";
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("workbox:unauthorized"));
    throw new Error(body.error || "连接失败，请稍后重试。");
  }
  return body as T;
}
// A future Windows shell implements this contract without changing tool pages.
export const desktop: DesktopAdapter = {
  capabilities: () => api<Capabilities>("/capabilities"),
  launch: (toolId) =>
    api(`/apps/${encodeURIComponent(toolId)}/launch`, {
      method: "POST",
      body: "{}",
    }),
  installationPlan: (toolId) =>
    api(`/apps/${encodeURIComponent(toolId)}/installation-plan`),
};
