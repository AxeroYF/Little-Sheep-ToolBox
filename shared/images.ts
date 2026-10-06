import { z } from "zod";

export const IMAGE_FORMATS = { png: "PNG", jpeg: "JPG", webp: "WebP", avif: "AVIF", tiff: "TIFF" } as const;
export type ImageFormat = keyof typeof IMAGE_FORMATS;
export const IMAGE_INPUT_ACCEPT = ".png,.jpg,.jpeg,.webp,.avif,.tif,.tiff,.gif";
export const IMAGE_FILE_LIMIT = 25 * 1024 * 1024;
export const IMAGE_BATCH_LIMIT = 50;
export const IMAGE_PIXEL_LIMIT = 40_000_000;
export const imageSettingsSchema = z.object({
  format: z.enum(["png", "jpeg", "webp", "avif", "tiff"]),
  quality: z.number().int().min(1).max(100).default(85),
  lossless: z.boolean().default(false),
  background: z.string().regex(/^#[0-9a-f]{6}$/i).default("#ffffff"),
}).strict();
export type ImageSettings = z.infer<typeof imageSettingsSchema>;
export interface WorkshopImage {
  id: string; name: string; format: string; width: number; height: number;
  bytes: number; alpha: boolean;
}
export interface ImageConversion {
  imageId: string; name: string; status: "queued" | "running" | "complete" | "failed" | "cancelled";
  outputName?: string; outputBytes?: number; error?: string;
}
export interface ImageJob {
  id: string; status: "running" | "complete" | "partial" | "failed" | "cancelled";
  settings: ImageSettings; items: ImageConversion[]; outputDirectory: string;
}
export interface ImageWorkshopState { images: WorkshopImage[]; job: ImageJob | null; outputDirectory: string }
