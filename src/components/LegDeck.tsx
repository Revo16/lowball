"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Avatar } from "@/components/ui";
import { removeLeg, restoreLeg } from "@/app/actions";

// The Bookie tab's legs, one card each. A leg someone entered for another
// player can be swiped left to remove it (with Undo, like Gmail). A leg the
// player picked himself shows a lock and can't be swiped.

export type DeckLeg = {
  userId: string;
  teamName: string;
  avatar: string | null;
  slot: string;
  selection: string;
  where: string; // "Lions @ Packers · Sun 10:00 AM"
  price: string;
  inLink: boolean;
  enteredBy: string | null;
  isMine: boolean;
  swipeable: boolean;
  changeHref: string | null;
};

const HINT_KEY = "lowball.swipe-hint";

export function LegDeck({ legs }: { legs: DeckLeg[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [snack, setSnack] = useState<{ text: string; undo?: string; userId?: string; error?: boolean } | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hintFor, setHintFor] = useState<string | null>(null);

  // Show once per phone how swiping works: the first swipeable card peeks left.
  useEffect(() => {
    const first = legs.find((l) => l.swipeable);
    if (!first) return;
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
      localStorage.setItem(HINT_KEY, "1");
    } catch {}
    if (seen) return;
    const t = setTimeout(() => setHintFor(first.userId), 700);
    return () => clearTimeout(t);
  }, [legs]);

  function show(next: NonNullable<typeof snack>) {
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSnack(next);
    snackTimer.current = setTimeout(() => setSnack(null), next.undo ? 6000 : 4000);
  }

  async function remove(leg: DeckLeg) {
    setGone((g) => new Set(g).add(leg.userId));
    const r = await removeLeg(leg.userId);
    if (r.error) {
      setGone((g) => {
        const n = new Set(g);
        n.delete(leg.userId);
        return n;
      });
      show({ text: r.error, error: true });
      return;
    }
    show({ text: `Removed ${leg.isMine ? "your" : `${leg.teamName}'s`} leg`, undo: r.undo, userId: leg.userId });
    router.refresh();
  }

  async function undo() {
    if (!snack?.undo) return;
    const { undo: token, userId } = snack;
    setSnack(null);
    const r = await restoreLeg(token);
    if (r.error) return show({ text: r.error, error: true });
    if (userId) {
      setGone((g) => {
        const n = new Set(g);
        n.delete(userId);
        return n;
      });
    }
    show({ text: "Put back on the slip" });
    router.refresh();
  }

  const visible = legs.filter((l) => !gone.has(l.userId));
  const anySwipe = visible.some((l) => l.swipeable);

  return (
    <>
      {anySwipe && (
        <p className="deck-legend">
          <span className="deck-legend-swipe" aria-hidden="true" /> Swipe left to remove a leg someone entered for a player.{" "}
          <LockIcon /> Own pick: only that player can change it.
        </p>
      )}
      <ul className="deck">
        {visible.map((l) => (
          <SwipeCard key={l.userId} leg={l} onRemove={() => remove(l)} hint={hintFor === l.userId} />
        ))}
      </ul>
      {snack && (
        <div className={`snack ${snack.error ? "snack-bad" : ""}`} role="status">
          <span>{snack.text}</span>
          {snack.undo && (
            <button type="button" className="snack-undo" onClick={undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </>
  );
}

function SwipeCard({ leg, onRemove, hint }: { leg: DeckLeg; onRemove: () => void; hint: boolean }) {
  const front = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; dx: number; horizontal: boolean | null; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!hint) return;
    setAnimating(true);
    setDx(-64);
    const t = setTimeout(() => setDx(0), 650);
    return () => clearTimeout(t);
  }, [hint]);

  function down(e: RPointerEvent<HTMLDivElement>) {
    if (!leg.swipeable || leaving) return;
    if ((e.target as HTMLElement).closest("a,button")) return;
    drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, horizontal: null, id: e.pointerId };
    setAnimating(false);
  }

  function move(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.horizontal === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      d.horizontal = Math.abs(mx) > Math.abs(my);
      if (!d.horizontal) {
        drag.current = null; // it's a scroll
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
    if (!d || !d.horizontal) return;
    const width = front.current?.offsetWidth ?? 320;
    const speed = -d.dx / Math.max(1, performance.now() - d.t); // px per ms
    setAnimating(true);
    if (d.dx < -width * 0.35 || (d.dx < -50 && speed > 0.6)) {
      setDx(-width - 20);
      setLeaving(true);
      setTimeout(onRemove, 220);
    } else {
      setDx(0);
    }
  }

  const reveal = Math.min(1, -dx / 90);

  return (
    <li className={`swipe ${leaving ? "leaving" : ""} ${leg.swipeable ? "can-swipe" : ""}`}>
      {leg.swipeable && (
        <div className="swipe-bg" aria-hidden="true" style={{ opacity: reveal }}>
          <TrashIcon />
          <span>Remove</span>
        </div>
      )}
      <div
        ref={front}
        className={`swipe-front ${animating ? "anim" : ""}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onTransitionEnd={() => setAnimating(false)}
      >
        <div className="dl-row">
          <span className="slot">{leg.slot}</span>
          <Avatar src={leg.avatar} name={leg.teamName} size={38} />
          <div className="dl-main">
            <strong>{leg.selection}</strong>
            <span className="dl-who">
              {leg.teamName}
              {leg.isMine && " (you)"}
              {leg.enteredBy ? (
                <span className="entered"> · Entered by {leg.enteredBy}</span>
              ) : (
                <span className="dl-own">
                  {" "}
                  · <LockIcon /> Own pick
                </span>
              )}
            </span>
          </div>
          <b className="dl-price mono">{leg.price}</b>
        </div>
        <div className="dl-foot">
          <span className="dl-where">{leg.where}</span>
          {leg.inLink ? <span className="pill pill-green">In link</span> : <span className="pill pill-amber">Add by hand</span>}
          {leg.changeHref && (
            <Link href={leg.changeHref} className="dl-change">
              Change
            </Link>
          )}
          {leg.swipeable && (
            <button type="button" className="sr-only" onClick={onRemove}>
              Remove {leg.teamName}&apos;s leg
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function LockIcon() {
  return (
    <svg className="lock-ic" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z"
        fill="currentColor"
      />
    </svg>
  );
}
