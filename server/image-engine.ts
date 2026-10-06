import { constants } from "node:fs";
import { copyFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Sharp } from "sharp";
import { IMAGE_PIXEL_LIMIT, type ImageSettings } from "../shared/images";

let engine: Promise<typeof import("sharp")["default"]> | undefined;
export async function imageEngine() {
  engine ??= import("sharp").then(({ default: sharp }) => {
    sharp.cache(false); sharp.concurrency(2); return sharp;
  });
  return engine;
}
export async function inspectImage(data: Buffer) {
  const sharp = await imageEngine();
  const metadata = await sharp(data, { limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: "error" }).metadata();
  if (!metadata.format || !["png", "jpeg", "webp", "heif", "tiff", "gif"].includes(metadata.format))
    throw new Error("不支持此图片格式");
  if ((metadata.pages ?? 1) > 1) throw new Error("首版仅支持静态、单页图片");
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > IMAGE_PIXEL_LIMIT)
    throw new Error("图片不能超过 4000 万像素");
  const swap = (metadata.orientation ?? 1) >= 5;
  return {format: metadata.format === "heif" ? "avif" : metadata.format,
    width: swap ? metadata.height : metadata.width, height: swap ? metadata.width : metadata.height,
    alpha: !!metadata.hasAlpha};
}
export async function imageThumbnail(input: Buffer | string, destination: string) {
  const sharp = await imageEngine();
  await sharp(input, { limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: "error" }).rotate()
    .resize({ width: 900, height: 700, fit: "inside", withoutEnlargement: true })
    .png().timeout({ seconds: 15 }).toFile(destination);
}
export async function convertImage(input: string, output: string, settings: ImageSettings, signal: AbortSignal) {
  signal.throwIfAborted();
  const sharp = await imageEngine();
  signal.throwIfAborted();
  let pipeline: Sharp = sharp(input, { limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: "error" }).rotate().toColourspace("srgb");
  if (settings.format === "jpeg") pipeline = pipeline.flatten({ background: settings.background }).jpeg({ quality: settings.quality, mozjpeg: false });
  if (settings.format === "png") pipeline = pipeline.png({ compressionLevel: 6 });
  if (settings.format === "webp") pipeline = pipeline.webp({ quality: settings.quality, lossless: settings.lossless, effort: 3 });
  if (settings.format === "avif") pipeline = pipeline.avif({ quality: settings.quality, effort: 3 });
  if (settings.format === "tiff") pipeline = pipeline.tiff({ compression: "lzw" });
  // Native work has a bounded deadline; cancellation never publishes its output.
  await pipeline.timeout({ seconds: 20 }).toFile(output);
  signal.throwIfAborted();
}
export function imageOutputStem(name: string) {
  const file = basename(name.replace(/\\/g, "/"));
  let stem = file.slice(0, file.length - extname(file).length).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "图片";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem)) stem = "_" + stem;
  return stem;
}
export async function publishImage(temp: string, directory: string, name: string, format: ImageSettings["format"]) {
  const stem = imageOutputStem(name), extension = format === "jpeg" ? "jpg" : format === "tiff" ? "tif" : format;
  for (let n = 0; n < 10000; n++) {
    const outputName = stem + (n ? ` (${n + 1})` : "") + "." + extension, path = join(directory, outputName);
    try {
      await copyFile(temp, path, constants.COPYFILE_EXCL);
      return { path, outputName, outputBytes: (await stat(path)).size };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  throw new Error("同名文件过多，请更换输出目录");
}
