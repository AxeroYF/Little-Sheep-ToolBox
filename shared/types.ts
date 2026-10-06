export type Theme = "system" | "light" | "dark";
export interface User {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
}
export interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  platform: "windows";
  version: string | null;
  installed: boolean;
  launchable: boolean;
  integration: "external" | "managed";
  runtime?: import("./app-runtime").AppRuntime;
}
export interface Preferences {
  favorites: string[];
  recent: { id: string; at: number }[];
  theme: Theme;
  closeToTray?: boolean;
  captureHotkey?: string;
  minimizeOnCapture?: boolean;
}
export interface Capabilities {
  registration: false;
  nativeLaunch: boolean;
  installer: { supported: false; apiVersion: 1 };
  mode: "desktop" | "local" | "web";
  version: string;
}
export interface DesktopAdapter {
  capabilities(): Promise<Capabilities>;
  launch(toolId: string): Promise<{
    status: "requested";
    requestedAt: number;
    page?: "screenshots";
  }>;
  installationPlan(
    toolId: string,
  ): Promise<{ supported: false; reason: string }>;
}
