import { z } from "zod";
import type { ComputerSample, HardwareSensor } from "./computer";
export const powerSettingsSchema = z
  .object({
    cpuIdle: z.number().min(0).max(1000).default(15),
    cpuFull: z.number().min(1).max(2000).default(150),
    gpuIdle: z.number().min(0).max(1000).default(15),
    gpuFull: z.number().min(0).max(3000).default(250),
    other: z.number().min(0).max(1000).default(50),
    efficiency: z.number().min(0.5).max(1).default(0.9),
  })
  .strict()
  .refine((v) => v.cpuFull >= v.cpuIdle && v.gpuFull >= v.gpuIdle, {
    message: "满载功耗不能低于空闲功耗",
  });
export type PowerSettings = z.infer<typeof powerSettingsSchema>;
export const defaultPowerSettings = () => powerSettingsSchema.parse({});
export type PowerPart = {
  name: string;
  watts: number;
  source: "sensor" | "estimated";
  detail: string;
};
// The ranges are sensitivity assumptions, not calibrated confidence intervals.
export function estimatePower(
  sample: ComputerSample | null,
  settings: PowerSettings,
) {
  if (!sample) return null;
  const sensors =
    sample.sensorStatus === "live" &&
    sample.sensorAt != null &&
    sample.at - sample.sensorAt <= 12000
      ? sample.sensors
      : [];
  const packagePower = (items: HardwareSensor[], names: string[]) =>
    names
      .map((name) =>
        items.find(
          (s) =>
            s.type === "Power" &&
            s.name.toLowerCase() === name &&
            s.value != null &&
            s.value > 0,
        ),
      )
      .find(Boolean);
  const parts: PowerPart[] = [];
  const cpuIds = [
    ...new Set(
      sensors.filter((s) => s.category === "Cpu").map((s) => s.hardwareId),
    ),
  ];
  const cpus = cpuIds.map((id) =>
    packagePower(
      sensors.filter((s) => s.hardwareId === id),
      ["cpu package", "package", "package power", "cpu package power"],
    ),
  );
  if (cpus.length && cpus.every(Boolean))
    parts.push({
      name: "CPU",
      watts: cpus.reduce((sum, p) => sum + p!.value!, 0),
      source: "sensor",
      detail: "CPU 封装功耗",
    });
  else if (sample.cpu != null)
    parts.push({
      name: "CPU",
      watts:
        settings.cpuIdle +
        ((settings.cpuFull - settings.cpuIdle) * sample.cpu) / 100,
      source: "estimated",
      detail: "按总负载与 CPU 参数估算",
    });
  else return null;
  const gpuIds = [
    ...new Set(
      sensors
        .filter(
          (s) =>
            s.category.startsWith("Gpu") &&
            !s.hardwareId.includes("integrated"),
        )
        .map((s) => s.hardwareId),
    ),
  ];
  const gpus = gpuIds.map((id) =>
    packagePower(
      sensors.filter((s) => s.hardwareId === id),
      [
        "gpu package",
        "gpu total board power",
        "gpu board power",
        "total board power",
        "gpu power",
      ],
    ),
  );
  if (gpus.length && gpus.every(Boolean))
    gpus.forEach((g, i) =>
      parts.push({
        name: g!.hardware,
        watts: g!.value!,
        source: "sensor",
        detail: gpuIds[i].includes("nvidia")
          ? "显卡板卡功耗"
          : "GPU 功耗传感器（范围依驱动）",
      }),
    );
  else if (settings.gpuFull === 0)
    parts.push({
      name: "独立显卡",
      watts: 0,
      source: "estimated",
      detail: "未配置独显",
    });
  else if (sample.gpu != null)
    parts.push({
      name: "GPU",
      watts:
        settings.gpuIdle +
        ((settings.gpuFull - settings.gpuIdle) * sample.gpu) / 100,
      source: "estimated",
      detail: "按总负载与 GPU 参数估算",
    });
  else return null;
  parts.push({
    name: "其他部件",
    watts: settings.other,
    source: "estimated",
    detail: "主板、内存、磁盘、风扇与供电损耗余量",
  });
  const dc = parts.reduce((sum, p) => sum + p.watts, 0),
    ac = dc / settings.efficiency;
  // Wide bounds emphasize that load is not a linear power sensor.
  const low =
    parts.reduce(
      (sum, p) => sum + p.watts * (p.source === "sensor" ? 0.9 : 0.5),
      0,
    ) / Math.min(1, settings.efficiency + 0.05);
  const high =
    parts.reduce(
      (sum, p) => sum + p.watts * (p.source === "sensor" ? 1.1 : 1.5),
      0,
    ) / Math.max(0.5, settings.efficiency - 0.05);
  return {
    dc,
    ac,
    low,
    high,
    parts,
    loss: ac - dc,
    modelled:
      parts.filter((p) => p.source === "estimated" && p.name !== "其他部件")
        .length > 0,
  };
}
