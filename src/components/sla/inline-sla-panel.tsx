import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export const INLINE_SLA_PANEL_MIN_WIDTH = 320;
export const INLINE_SLA_PANEL_MAX_WIDTH = 960;
export const INLINE_SLA_PANEL_DEFAULT_WIDTH = 480;
const INLINE_SLA_PANEL_KEYBOARD_STEP = 24;

export function clampInlineSlaPanelWidth(width: number) {
  return Math.min(INLINE_SLA_PANEL_MAX_WIDTH, Math.max(INLINE_SLA_PANEL_MIN_WIDTH, Math.round(width)));
}

// The handle sits on the left edge: dragging left (negative delta) widens the panel.
export function resizeInlineSlaPanel(width: number, deltaX: number) {
  return clampInlineSlaPanelWidth(width - deltaX);
}

export function createSingleFire(callback: () => void) {
  let fired = false;
  return () => {
    if (fired) return;
    fired = true;
    callback();
  };
}

interface InlineSlaPanelProps {
  children: ReactNode;
  onClose: () => void;
}

export function InlineSlaPanel({ children, onClose }: InlineSlaPanelProps) {
  const [width, setWidth] = useState(INLINE_SLA_PANEL_DEFAULT_WIDTH);
  const previousFocus = useRef<HTMLElement | null>(null);
  const backButton = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useMemo(() => createSingleFire(() => onCloseRef.current()), []);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backButton.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [close]);

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = width;
    handle.setPointerCapture(pointerId);

    const move = (moveEvent: globalThis.PointerEvent) => {
      setWidth(resizeInlineSlaPanel(startWidth, moveEvent.clientX - startX));
    };
    const stop = () => {
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30" onClick={close}>
      <section
        id="sla-detail-inline-panel"
        role="dialog"
        aria-modal="true"
        aria-label="SLA detail"
        className="absolute inset-y-0 right-0 max-w-[90vw] overflow-y-auto border-l bg-background p-6 shadow-xl"
        style={{ width }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          role="separator"
          aria-label="Resize SLA panel"
          aria-orientation="vertical"
          aria-valuemin={INLINE_SLA_PANEL_MIN_WIDTH}
          aria-valuemax={INLINE_SLA_PANEL_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          className="absolute inset-y-0 left-0 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setWidth((current) => clampInlineSlaPanelWidth(current + INLINE_SLA_PANEL_KEYBOARD_STEP));
            if (event.key === "ArrowRight") setWidth((current) => clampInlineSlaPanelWidth(current - INLINE_SLA_PANEL_KEYBOARD_STEP));
          }}
        />
        <Button ref={backButton} variant="ghost" size="sm" onClick={close}>
          <ArrowLeft className="size-4" />
          Back to Ticket
        </Button>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}
