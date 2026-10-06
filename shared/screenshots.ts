export type CaptureMode = "region" | "window" | "screen" | "edit";
export interface Screenshot {
  id: string;
  title: string;
  category: string;
  favorite: boolean;
  createdAt: number;
  width: number;
  height: number;
  bytes: number;
  parentId: string | null;
  deletedAt: number | null;
}
export interface CaptureJob {
  id: string;
  status: "starting" | "running" | "complete" | "cancelled" | "failed";
  mode: CaptureMode;
  error: string;
  imageId: string | null;
}
export interface ScreenshotStatus {
  available: boolean;
  version: string;
  job: CaptureJob | null;
}
