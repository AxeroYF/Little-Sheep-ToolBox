import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ComputerSampler } from "../server/computer";
const sampler = new ComputerSampler(resolve("desktop-dev/ComputerProbe.exe"));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  async function ready() {
    let state = sampler.snapshot();
    for (let i = 0; i < 24 && !state.sample; i++) {
      await delay(250);
      state = sampler.snapshot();
    }
    assert.equal(state.status, "live");
    assert.ok(state.sample?.memoryTotal);
    return state;
  }
  await ready();
  await delay(8000);
  const resumed = sampler.snapshot();
  assert.equal(resumed.sample, null);
  assert.equal(resumed.history.length, 0);
  assert.equal(resumed.status, "starting");
  await ready();
  sampler.dispose();
  assert.equal(sampler.snapshot().sample, null);
  await delay(1200);
  assert.equal(sampler.snapshot().sample, null);
  console.log(
    "PASS: real sampler idles out with no viewers, restarts on demand and remains stopped after dispose",
  );
} finally {
  sampler.dispose();
}
