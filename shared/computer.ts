import { z } from "zod";
import { normalizeCaptureHotkey } from "./hotkey";
export const computerSettingsSchema = z
  .object({
    hotkey: z
      .string()
      .transform((v, ctx) => {
        const value = normalizeCaptureHotkey(v);
        if (value) return value;
        ctx.addIssue({ code: "custom", message: "不支持这个快捷键" });
        return z.NEVER;
      })
      .default("Ctrl+Alt+R"),
    mode: z.enum(["mini", "compact"]).default("compact"),
    anchor: z
      .enum(["top-right", "top-left", "bottom-right", "bottom-left"])
      .default("top-right"),
    opacity: z.number().min(0.4).max(1).default(0.88),
    closeToTray: z.boolean().default(true),
  })
  .strict();
export type ComputerSettings = z.infer<typeof computerSettingsSchema>;
export const defaultComputerSettings = () => computerSettingsSchema.parse({});
const metric = z.number().finite().nonnegative().nullable();
const percent = z.number().finite().min(0).max(100).nullable();
export const hardwareSensorSchema = z.object({
  id: z.string(),
  hardwareId: z.string(),
  hardware: z.string(),
  category: z.string(),
  name: z.string(),
  type: z.string(),
  value: z.number().finite().nullable(),
});
export type HardwareSensor = z.infer<typeof hardwareSensorSchema>;
export const computerSampleSchema = z.object({
  at: z.number(),
  cpu: percent,
  cpuMhz: metric,
  processors: z
    .array(
      z.object({
        id: z.string(),
        group: z.number().int().nonnegative(),
        index: z.number().int().nonnegative(),
        usage: percent,
      }),
    )
    .max(4096)
    .default([]),
  disks: z
    .array(
      z.object({
        id: z.string(),
        read: metric,
        write: metric,
        active: percent,
        queue: metric,
      }),
    )
    .max(256)
    .default([]),
  sensors: z.array(hardwareSensorSchema).max(4096).default([]),
  sensorAt: metric.default(null),
  sensorStatus: z.enum(["starting", "live", "unavailable"]).default("starting"),
  sensorError: z.string().nullable().default(null),
  memoryAvailable: metric.default(null),
  commitUsed: metric.default(null),
  commitLimit: metric.default(null),
  memoryUsed: metric,
  memoryTotal: metric,
  diskRead: metric,
  diskWrite: metric,
  gpu: percent,
  gpuMemoryUsed: metric,
  networks: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        virtual: z.boolean(),
        receive: metric,
        send: metric,
        linkSpeed: metric.optional(),
        receivedBytes: metric.optional(),
        sentBytes: metric.optional(),
        description: z.string().optional(),
        addresses: z.array(z.string()).optional(),
      }),
    )
    .max(100),
  gpus: z
    .array(
      z.object({
        name: z.string(),
        usage: percent,
        temperature: metric,
        memoryUsed: metric,
        memoryTotal: metric,
      }),
    )
    .max(32),
  uptimeSeconds: metric,
});
export type ComputerSample = z.infer<typeof computerSampleSchema>;
export const computerInfoSchema = z.object({
  cpu: z.string(),
  logicalProcessors: z.number(),
  os: z.string(),
  gpus: z.array(z.string()),
  drives: z
    .array(
      z.object({
        name: z.string(),
        total: metric,
        free: metric,
        label: z.string().optional(),
        format: z.string().optional(),
      }),
    )
    .max(100),
  cpuDetails: z
    .object({
      cores: metric,
      sockets: metric,
      maxMhz: metric,
      l2KB: metric,
      l3KB: metric,
    })
    .nullable()
    .default(null),
  memoryModules: z
    .array(
      z.object({
        slot: z.string(),
        manufacturer: z.string(),
        part: z.string(),
        capacity: metric,
        speed: metric,
        configuredSpeed: metric,
      }),
    )
    .default([]),
  physicalDisks: z
    .array(
      z.object({
        index: z.number(),
        model: z.string(),
        size: metric,
        interface: z.string(),
      }),
    )
    .default([]),
  gpuDetails: z
    .array(
      z.object({
        name: z.string(),
        driver: z.string(),
        resolution: z.string(),
      }),
    )
    .default([]),
  board: z
    .object({ manufacturer: z.string(), model: z.string(), bios: z.string() })
    .nullable()
    .default(null),
});
export type ComputerInfo = z.infer<typeof computerInfoSchema>;
export type ComputerSnapshot = {
  info: ComputerInfo | null;
  sample: ComputerSample | null;
  history: ComputerSample[];
  status: "starting" | "live" | "unavailable";
  error: string | null;
};
export function selectedNetwork(sample: ComputerSample | null, id: string) {
  if (id !== "auto") return sample?.networks.find((n) => n.id === id);
  return (
    sample?.networks
      .filter((n) => !n.virtual)
      .sort(
        (a, b) =>
          (b.receive ?? 0) + (b.send ?? 0) - (a.receive ?? 0) - (a.send ?? 0),
      )[0] ?? sample?.networks[0]
  );
}
