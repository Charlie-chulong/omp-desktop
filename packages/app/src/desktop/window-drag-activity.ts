export type WindowDragActivityToken = symbol;

const activeWindowDrags = new Set<WindowDragActivityToken>();

export function beginWindowDragActivity(): WindowDragActivityToken {
  const token = Symbol("window-drag");
  activeWindowDrags.add(token);
  return token;
}

export function endWindowDragActivity(token: WindowDragActivityToken | null): void {
  if (token) activeWindowDrags.delete(token);
}

export function isWindowDragActive(): boolean {
  return activeWindowDrags.size > 0;
}
