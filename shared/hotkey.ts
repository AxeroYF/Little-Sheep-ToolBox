export const DEFAULT_CAPTURE_HOTKEY = "Ctrl+Alt+S";

// Persist a small canonical keyboard vocabulary shared with the Windows host.
export function normalizeCaptureHotkey(value: string): string | null {
  const parts = value.split("+").map((s) => s.trim());
  const key = parts.pop() ?? "";
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|10|11)|PrintScreen)$/.test(key)) return null;
  if (
    new Set(parts).size !== parts.length ||
    parts.some((p) => !["Ctrl", "Alt", "Shift"].includes(p))
  )
    return null;
  if (
    /^[A-Z0-9]$/.test(key) &&
    !parts.includes("Ctrl") &&
    !parts.includes("Alt")
  )
    return null;
  if (key === "F4" && parts.includes("Alt")) return null;
  return [
    ...["Ctrl", "Alt", "Shift"].filter((p) => parts.includes(p)),
    key,
  ].join("+");
}

export function captureHotkeyFromEvent(e: {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  if (e.metaKey) return null;
  const key = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3)
    : /^Digit[0-9]$/.test(e.code)
      ? e.code.slice(5)
      : e.key;
  return normalizeCaptureHotkey(
    [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key]
      .filter(Boolean)
      .join("+"),
  );
}
export const displayHotkey = (value: string) => value.split("+").join(" + ");
