"use client";

import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

// One Slip card. A card you can act on is raised like a button:
//  - tap it to change the leg (or add one to an empty slot)
//  - swipe it left to remove the leg (red edge on the right), with Undo
// A card you can't touch sits flat and does nothing.

export function SwipeTap({
  className,
  canTap,
  canSwipe,
  onTap,
  onRemove,
  label,
  children,
}: {
  className: string;
  canTap: boolean;
  canSwipe: boolean;
  onTap: () => void;
  onRemove: () => void;
  label: string;
  children: ReactNode;
}) {
  const front = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; dx: number; horizontal: boolean | null; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pressed, setPressed] = useState(false);

  function down(e: RPointerEvent<HTMLDivElement>) {
    if ((!canTap && !canSwipe) || leaving) return;
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, horizontal: null, id: e.pointerId };
    setAnim(false);
    setPressed(true);
  }

  function move(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.horizontal === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      setPressed(false);
      d.horizontal = Math.abs(mx) > Math.abs(my) && canSwipe;
      if (!d.horizontal) {
        drag.current = null; // a scroll, or a sideways move on a card that doesn't swipe
        return;
      }
      front.current?.setPointerCapture(e.pointerId);
    }
    d.dx = Math.min(0, mx);
    setDx(d.dx);
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    setPressed(false);
    if (!d) return;
    if (d.horizontal === null) {
      // Barely moved: a tap.
      if (canTap) onTap();
      return;
    }
    const width = front.current?.offsetWidth ?? 320;
    const speed = Math.abs(d.dx) / Math.max(1, performance.now() - d.t);
    setAnim(true);
    if (d.dx < -width * 0.35 || (d.dx < -50 && speed > 0.6)) {
      setDx(-width - 20);
      setLeaving(true);
      setTimeout(onRemove, 220);
    } else {
      setDx(0);
    }
  }

  const reveal = Math.min(1, Math.abs(dx) / 90);
  const cls = [
    className,
    "st",
    canTap ? "st-tap" : "",
    canSwipe ? "st-swipe" : "",
    pressed ? "st-pressed" : "",
    leaving ? "st-leaving" : "",
  ].join(" ");

  return (
    <li className={cls}>
      {canSwipe && dx < 0 && (
        <div className="st-bg" aria-hidden="true" style={{ opacity: reveal }}>
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" fill="currentColor" /></svg>
          <span>Remove</span>
        </div>
      )}
      <div
        ref={front}
        className={`st-front ${anim ? "anim" : ""}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          drag.current = null;
          setPressed(false);
          setAnim(true);
          setDx(0);
        }}
        onTransitionEnd={() => setAnim(false)}
        role={canTap ? "button" : undefined}
        tabIndex={canTap ? 0 : undefined}
        aria-label={canTap ? label : undefined}
        onKeyDown={(e) => {
          if (canTap && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onTap();
          }
        }}
      >
        {children}
      </div>
      {canSwipe && (
        <button type="button" className="sr-only" onClick={onRemove}>
          Remove this leg
        </button>
      )}
    </li>
  );
}
