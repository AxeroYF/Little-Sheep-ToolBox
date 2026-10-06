import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPowerSettings,
  estimatePower,
  powerSettingsSchema,
} from "../shared/power";
import type { ComputerSample, HardwareSensor } from "../shared/computer";
const sensor = (
  id: string,
  name: string,
  value: number,
  category = "Cpu",
): HardwareSensor => ({
  id: id + "/" + name,
  hardwareId: id,
  hardware: id,
  category,
  name,
  type: "Power",
  value,
});
const sample = (
  sensors: HardwareSensor[],
  patch: Partial<ComputerSample> = {},
) =>
  ({
    at: 10000,
    sensorAt: 10000,
    sensorStatus: "live",
    sensors,
    cpu: 50,
    gpu: 25,
    ...patch,
  }) as ComputerSample;
test("power uses one package per device; never sums package and subdomains; PSU loss is outside DC total", () => {
  const p = estimatePower(
    sample([
      sensor("/cpu/0", "CPU Package", 50),
      sensor("/cpu/0", "CPU Cores", 40),
      sensor("/gpu-nvidia/0", "GPU Package", 100, "GpuNvidia"),
      sensor("/gpu-nvidia/0", "GPU Core", 80, "GpuNvidia"),
      sensor("/gpu-intel-integrated/0", "GPU Power", 7, "GpuIntel"),
    ]),
    { ...defaultPowerSettings(), other: 30, efficiency: 0.9 },
  )!;
  assert.equal(p.dc, 180);
  assert.equal(p.ac, 200);
  assert.equal(p.loss, 20);
  assert.equal(p.modelled, false);
  assert.ok(p.low < p.ac && p.ac < p.high);
  assert.equal(p.parts.length, 3);
});
test("multiple CPU sockets and multiple discrete GPUs sum independently", () => {
  const p = estimatePower(
    sample([
      sensor("/cpu/0", "CPU Package", 50),
      sensor("/cpu/1", "Package", 60),
      sensor("/gpu-nvidia/0", "GPU Package", 100, "GpuNvidia"),
      sensor("/gpu-nvidia/1", "GPU Package", 200, "GpuNvidia"),
    ]),
    { ...defaultPowerSettings(), other: 0, efficiency: 1 },
  )!;
  assert.equal(p.ac, 410);
});
test("zero, missing or stale package readings use explicitly labelled estimates", () => {
  for (const s of [
    sample([sensor("/cpu/0", "CPU Package", 0)]),
    sample([sensor("/cpu/0", "CPU Package", 999)], { at: 30000 }),
    sample([]),
  ]) {
    const p = estimatePower(s, defaultPowerSettings())!;
    assert.equal(p.parts[0].watts, 82.5);
    assert.equal(p.parts[0].source, "estimated");
    assert.ok(p.modelled);
  }
  assert.equal(estimatePower(null, defaultPowerSettings()), null);
  assert.equal(
    estimatePower(sample([], { cpu: null }), defaultPowerSettings()),
    null,
  );
});
test("power parameter validation and explicit no discrete GPU", () => {
  assert.equal(
    powerSettingsSchema.safeParse({ ...defaultPowerSettings(), efficiency: 0 })
      .success,
    false,
  );
  assert.equal(
    powerSettingsSchema.safeParse({
      ...defaultPowerSettings(),
      cpuIdle: 200,
      cpuFull: 50,
    }).success,
    false,
  );
  assert.equal(
    estimatePower(sample([], { gpu: null }), {
      ...defaultPowerSettings(),
      gpuFull: 0,
      gpuIdle: 0,
    })?.parts[1].watts,
    0,
  );
});
