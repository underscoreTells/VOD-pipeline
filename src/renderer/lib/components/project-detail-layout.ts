interface LayoutControllerDeps {
  getLeftWidth: () => number;
  setLeftWidth: (width: number) => void;
  getRightWidth: () => number;
  setRightWidth: (width: number) => void;
  getPreviewHeight: () => number;
  setPreviewHeight: (height: number) => void;
  getClipPreviewWidth: () => number;
  setClipPreviewWidth: (width: number) => void;
  persistLayout: () => void;
  getEditorMainRef: () => HTMLElement | null;
  getPreviewTopLayoutRef: () => HTMLElement | null;
}

interface LayoutConstraints {
  resizeHandleSize: number;
  minLeftWidth: number;
  maxLeftWidth: number;
  minRightWidth: number;
  maxRightWidth: number;
  minPreviewHeight: number;
  minTimelineHeight: number;
  minClipPreviewWidth: number;
  minChapterPreviewWidth: number;
}

export function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function startPointerDrag(
  event: PointerEvent,
  cursor: 'col-resize' | 'row-resize',
  onMove: (moveEvent: PointerEvent) => void,
  onEnd?: () => void
): void {
  event.preventDefault();
  const previousCursor = document.body.style.cursor;
  const previousSelect = document.body.style.userSelect;
  document.body.style.cursor = cursor;
  document.body.style.userSelect = 'none';

  const handleMove = (moveEvent: PointerEvent) => {
    onMove(moveEvent);
  };

  const handleUp = () => {
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelect;
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    onEnd?.();
  };

  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp);
}

export function createProjectDetailLayoutController(
  deps: LayoutControllerDeps,
  constraints: LayoutConstraints
) {
  function getMaxClipPreviewWidth(): number {
    const previewTopLayoutRef = deps.getPreviewTopLayoutRef();
    if (!previewTopLayoutRef) {
      return Math.max(constraints.minClipPreviewWidth, deps.getClipPreviewWidth());
    }

    const availableWidth = previewTopLayoutRef.clientWidth;
    const max = availableWidth - constraints.minChapterPreviewWidth - constraints.resizeHandleSize;
    return Math.max(constraints.minClipPreviewWidth, max);
  }

  function clampClipPreviewWidth(): void {
    const maxWidth = getMaxClipPreviewWidth();
    const nextWidth = clampValue(
      deps.getClipPreviewWidth(),
      constraints.minClipPreviewWidth,
      maxWidth
    );
    if (nextWidth !== deps.getClipPreviewWidth()) {
      deps.setClipPreviewWidth(nextWidth);
      deps.persistLayout();
    }
  }

  return {
    clampClipPreviewWidth,
    handleLeftResize(event: PointerEvent): void {
      const startX = event.clientX;
      const startWidth = deps.getLeftWidth();
      startPointerDrag(event, 'col-resize', (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const next = clampValue(
          startWidth + delta,
          constraints.minLeftWidth,
          constraints.maxLeftWidth
        );
        deps.setLeftWidth(next);
      }, deps.persistLayout);
    },
    handleRightResize(event: PointerEvent): void {
      const startX = event.clientX;
      const startWidth = deps.getRightWidth();
      startPointerDrag(event, 'col-resize', (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const next = clampValue(
          startWidth - delta,
          constraints.minRightWidth,
          constraints.maxRightWidth
        );
        deps.setRightWidth(next);
      }, deps.persistLayout);
    },
    handlePreviewResize(event: PointerEvent): void {
      const editorMainRef = deps.getEditorMainRef();
      if (!editorMainRef) {
        return;
      }

      const startY = event.clientY;
      const startHeight = deps.getPreviewHeight();
      const containerHeight = editorMainRef.clientHeight;
      const maxHeight = Math.max(
        constraints.minPreviewHeight,
        containerHeight - constraints.minTimelineHeight - constraints.resizeHandleSize
      );

      startPointerDrag(event, 'row-resize', (moveEvent) => {
        const delta = moveEvent.clientY - startY;
        const next = clampValue(startHeight + delta, constraints.minPreviewHeight, maxHeight);
        deps.setPreviewHeight(next);
      }, deps.persistLayout);
    },
    handleClipPreviewResize(event: PointerEvent): void {
      if (!deps.getPreviewTopLayoutRef()) {
        return;
      }

      const startX = event.clientX;
      const startWidth = deps.getClipPreviewWidth();

      startPointerDrag(event, 'col-resize', (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const maxWidth = getMaxClipPreviewWidth();
        const next = clampValue(
          startWidth + delta,
          constraints.minClipPreviewWidth,
          maxWidth
        );
        deps.setClipPreviewWidth(next);
      }, deps.persistLayout);
    },
  };
}
