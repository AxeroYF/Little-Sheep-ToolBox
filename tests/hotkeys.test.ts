import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCaptureHotkey,
  captureHotkeyFromEvent,
} from "../shared/hotkey";
test("custom shortcut vocabulary, keyboard recording and reserved keys", () => {
  assert.equal(normalizeCaptureHotkey("Shift+Ctrl+K"), "Ctrl+Shift+K");
  for (const valid of [
    "Ctrl+Alt+S",
    "Ctrl+Shift+8",
    "Alt+Q",
    "F9",
    "PrintScreen",
    "Alt+PrintScreen",
  ])
    assert.equal(normalizeCaptureHotkey(valid), valid);
  for (const invalid of [
    "A",
    "Shift+A",
    "Ctrl+Ctrl+A",
    "Alt+F4",
    "F12",
    "Win+S",
    "Ctrl+;",
    "",
  ])
    assert.equal(normalizeCaptureHotkey(invalid), null);
  assert.equal(
    captureHotkeyFromEvent({
      code: "KeyK",
      key: "k",
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    }),
    "Ctrl+Shift+K",
  );
  assert.equal(
    captureHotkeyFromEvent({
      code: "Digit8",
      key: "*",
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    }),
    "Ctrl+Shift+8",
  );
});
