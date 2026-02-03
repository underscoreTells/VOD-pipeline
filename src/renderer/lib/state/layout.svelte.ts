export interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  previewHeight: number;
  chatHeight: number;
  leftCollapsed: boolean;
  chatCollapsed: boolean;
  beatCollapsed: boolean;
  lastLeftWidth: number;
  lastRightWidth: number;
  lastPreviewHeight: number;
  lastChatHeight: number;
}

const DEFAULT_LEFT_WIDTH = 300;
const DEFAULT_RIGHT_WIDTH = 360;
const DEFAULT_PREVIEW_HEIGHT = 280;
const DEFAULT_CHAT_HEIGHT = 360;

const STORAGE_KEY = "vod-pipeline-layout";

export const layoutState = $state<LayoutState>({
  leftWidth: DEFAULT_LEFT_WIDTH,
  rightWidth: DEFAULT_RIGHT_WIDTH,
  previewHeight: DEFAULT_PREVIEW_HEIGHT,
  chatHeight: DEFAULT_CHAT_HEIGHT,
  leftCollapsed: false,
  chatCollapsed: false,
  beatCollapsed: false,
  lastLeftWidth: DEFAULT_LEFT_WIDTH,
  lastRightWidth: DEFAULT_RIGHT_WIDTH,
  lastPreviewHeight: DEFAULT_PREVIEW_HEIGHT,
  lastChatHeight: DEFAULT_CHAT_HEIGHT,
});

function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") return null;
  return value;
}

export function loadLayout(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    const parsed = JSON.parse(stored);

    const leftWidth = readNumber(parsed.leftWidth);
    const rightWidth = readNumber(parsed.rightWidth);
    const previewHeight = readNumber(parsed.previewHeight);
    const chatHeight = readNumber(parsed.chatHeight);

    const leftCollapsed = readBoolean(parsed.leftCollapsed);
    const chatCollapsed = readBoolean(parsed.chatCollapsed);
    const beatCollapsed = readBoolean(parsed.beatCollapsed);

    if (leftWidth !== null) layoutState.leftWidth = leftWidth;
    if (rightWidth !== null) layoutState.rightWidth = rightWidth;
    if (previewHeight !== null) layoutState.previewHeight = previewHeight;
    if (chatHeight !== null) layoutState.chatHeight = chatHeight;

    if (leftCollapsed !== null) layoutState.leftCollapsed = leftCollapsed;
    if (chatCollapsed !== null) layoutState.chatCollapsed = chatCollapsed;
    if (beatCollapsed !== null) layoutState.beatCollapsed = beatCollapsed;

    layoutState.lastLeftWidth = readNumber(parsed.lastLeftWidth) ?? layoutState.leftWidth;
    layoutState.lastRightWidth = readNumber(parsed.lastRightWidth) ?? layoutState.rightWidth;
    layoutState.lastPreviewHeight = readNumber(parsed.lastPreviewHeight) ?? layoutState.previewHeight;
    layoutState.lastChatHeight = readNumber(parsed.lastChatHeight) ?? layoutState.chatHeight;
  } catch (error) {
    console.warn("[Layout] Failed to load layout state", error);
  }
}

export function persistLayout(): void {
  try {
    const payload = {
      leftWidth: layoutState.leftWidth,
      rightWidth: layoutState.rightWidth,
      previewHeight: layoutState.previewHeight,
      chatHeight: layoutState.chatHeight,
      leftCollapsed: layoutState.leftCollapsed,
      chatCollapsed: layoutState.chatCollapsed,
      beatCollapsed: layoutState.beatCollapsed,
      lastLeftWidth: layoutState.lastLeftWidth,
      lastRightWidth: layoutState.lastRightWidth,
      lastPreviewHeight: layoutState.lastPreviewHeight,
      lastChatHeight: layoutState.lastChatHeight,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("[Layout] Failed to persist layout state", error);
  }
}

export function setLeftWidth(width: number): void {
  layoutState.leftWidth = width;
  layoutState.lastLeftWidth = width;
}

export function setRightWidth(width: number): void {
  layoutState.rightWidth = width;
  layoutState.lastRightWidth = width;
}

export function setPreviewHeight(height: number): void {
  layoutState.previewHeight = height;
  layoutState.lastPreviewHeight = height;
}

export function setChatHeight(height: number): void {
  layoutState.chatHeight = height;
  layoutState.lastChatHeight = height;
}

export function collapseLeft(): void {
  if (!layoutState.leftCollapsed) {
    layoutState.lastLeftWidth = layoutState.leftWidth || layoutState.lastLeftWidth;
  }
  layoutState.leftCollapsed = true;
  persistLayout();
}

export function expandLeft(): void {
  layoutState.leftCollapsed = false;
  layoutState.leftWidth = layoutState.lastLeftWidth || DEFAULT_LEFT_WIDTH;
  persistLayout();
}

export function collapseChat(): void {
  if (!layoutState.chatCollapsed) {
    layoutState.lastChatHeight = layoutState.chatHeight || layoutState.lastChatHeight;
  }
  layoutState.chatCollapsed = true;
  persistLayout();
}

export function expandChat(): void {
  layoutState.chatCollapsed = false;
  layoutState.chatHeight = layoutState.lastChatHeight || DEFAULT_CHAT_HEIGHT;
  persistLayout();
}

export function collapseBeat(): void {
  layoutState.beatCollapsed = true;
  persistLayout();
}

export function expandBeat(): void {
  layoutState.beatCollapsed = false;
  persistLayout();
}

export function expandRightPanels(): void {
  layoutState.chatCollapsed = false;
  layoutState.beatCollapsed = false;
  layoutState.chatHeight = layoutState.lastChatHeight || DEFAULT_CHAT_HEIGHT;
  persistLayout();
}
