"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Avatar } from "@/components/ui";
import { removeLeg, restoreLeg } from "@/app/actions";

// The Bookie tab's legs, one card each, Gmail-style:
//  - swipe right to change (yellow edge on the left), swipe left to remove
//    (red edge on the right, with Undo). Both or neither: your own leg until
//    the lock, legs someone entered for a player until it's placed, and every
//    leg for the admin (lib/legrules).
// A leg the player picked himself shows a lock; only he (or the admin) can touch it.
// A pool member with no leg yet gets an empty card with a + button to add a
// pick for them (texted-in picks). Empty cards don't swipe.

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
  /** Swipe left to remove. */
  swipeable: boolean;
  /** Swipe right to change; on an empty card, where the + button goes. */
  changeHref: string | null;
  /** No leg yet: an empty slot. */
  empty: boolean;
  notifyOff: boolean;
};

const HINT_KEY = "lowball.swipe-hint";

export function LegDeck({ legs, isAdmin }: { legs: DeckLeg[]; isAdmin: boolean }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [snack, setSnack] = useState<{ text: string; undo?: string; userId?: string; error?: boolean } | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hintFor, setHintFor] = useState<string | null>(null);

  // Show once per phone how swiping works: the first swipeable card peeks left.
  useEffect(() => {
    const first = legs.find((l) => !l.empty && (l.swipeable || l.changeHref));
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

  // A removed leg disappears right away; its empty card arrives with the refresh.
  const visible = legs.filter((l) => l.empty || !gone.has(l.userId));
  const filled = visible.filter((l) => !l.empty);
  const anyRemove = filled.some((l) => l.swipeable);
  const anyChange = filled.some((l) => l.changeHref);
  const anyLocked = filled.some((l) => !l.enteredBy);
  const anyAdd = visible.some((l) => l.empty && l.changeHref);

  return (
    <>
      {(anyRemove || anyChange || anyAdd) && (
        <ul className="deck-legend">
          {anyAdd && (
            <li>
              <span className="add-dot" aria-hidden="true"><PlusIcon size={8} /></span> Tap to add a pick for someone
            </li>
          )}
          {anyChange && (
            <li>
              <span className="edge edge-change" aria-hidden="true" /> Swipe right to change
            </li>
          )}
          {anyRemove && (
            <li>
              <span className="edge edge-remove" aria-hidden="true" /> Swipe left to remove
            </li>
          )}
          {anyLocked && (
            <li>
              <LockIcon /> Own pick: {isAdmin ? "only the player (and you, as admin) can touch it" : "only that player can change it"}
            </li>
          )}
        </ul>
      )}
      <ul className="deck">
        {visible.map((l) => (
          <SwipeCard key={`${l.userId}${l.empty ? ":empty" : ""}`} leg={l} onRemove={() => remove(l)} onChange={() => l.changeHref && router.push(l.changeHref)} hint={hintFor === l.userId} />
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

function SwipeCard({ leg, onRemove, onChange, hint }: { leg: DeckLeg; onRemove: () => void; onChange: () => void; hint: boolean }) {
  // Empty cards don't swipe: the + button is the only way in.
  const canLeft = !leg.empty && leg.swipeable;
  const canRight = !leg.empty && !!leg.changeHref;
  const front = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; dx: number; horizontal: boolean | null; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!hint) return;
    // Peek each way this card can go, so the edges make sense.
    const steps = [...(canRight ? [56, 0] : []), ...(canLeft ? [-56, 0] : [])];
    const timers = steps.map((x, i) => setTimeout(() => { setAnimating(true); setDx(x); }, i * 520));
    return () => timers.forEach(clearTimeout);
  }, [hint, canLeft, canRight]);

  function down(e: RPointerEvent<HTMLDivElement>) {
    if ((!canLeft && !canRight) || leaving) return;
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
    d.dx = Math.max(canLeft ? -Infinity : 0, Math.min(canRight ? Infinity : 0, mx));
    setDx(d.dx);
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.horizontal) return;
    const width = front.current?.offsetWidth ?? 320;
    const speed = Math.abs(d.dx) / Math.max(1, performance.now() - d.t); // px per ms
    const far = Math.abs(d.dx) > width * 0.35 || (Math.abs(d.dx) > 50 && speed > 0.6);
    setAnimating(true);
    if (far && d.dx < 0 && canLeft) {
      setDx(-width - 20);
      setLeaving(true);
      setTimeout(onRemove, 220);
    } else if (far && d.dx > 0 && canRight) {
      setDx(width * 0.4);
      setTimeout(onChange, 160);
    } else {
      setDx(0);
    }
  }

  const reveal = Math.min(1, Math.abs(dx) / 90);

  return (
    <li className={`swipe ${leg.empty ? "is-empty" : ""} ${leaving ? "leaving" : ""} ${canLeft ? "can-remove" : ""} ${canRight ? "can-change" : ""} ${dx > 0 ? "going-right" : ""}`}>
      {canRight && dx > 0 && (
        <div className="swipe-bg swipe-bg-change" aria-hidden="true" style={{ opacity: reveal }}>
          <PencilIcon />
          <span>Change</span>
        </div>
      )}
      {canLeft && dx < 0 && (
        <div className="swipe-bg swipe-bg-remove" aria-hidden="true" style={{ opacity: reveal }}>
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
        {leg.empty ? (
          <div className="dl-row">
            <span className="slot">—</span>
            <Avatar src={leg.avatar} name={leg.teamName} size={38} />
            <div className="dl-main">
              <strong className="empty-sel">Empty</strong>
              <span className="dl-who">
                {leg.teamName}
                {leg.isMine && " (you)"}
                {leg.notifyOff && " · notifications off"}
              </span>
            </div>
            {leg.changeHref ? (
              <Link href={leg.changeHref} className="add-circle" aria-label={`Add a pick for ${leg.isMine ? "yourself" : leg.teamName}`}>
                <PlusIcon size={18} />
              </Link>
            ) : (
              <b className="dl-dash">—</b>
            )}
          </div>
        ) : (
          <>
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
              <Link href={leg.changeHref} className="sr-only">
                Change {leg.teamName}&apos;s leg
              </Link>
            )}
            {leg.swipeable && (
              <button type="button" className="sr-only" onClick={onRemove}>
                Remove {leg.teamName}&apos;s leg
              </button>
            )}
          </div>
          </>
        )}
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

// Drawn, not typed, so it sits dead centre in the circle whatever the font.
function PlusIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 18 18" width={size} height={size} aria-hidden="true" style={{ display: "block" }}>
      <path d="M9 2v14M2 9h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M4 17.5V20h2.5L17.1 9.4l-2.5-2.5L4 17.5Zm15.7-10.2a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.3 1.3 2.5 2.5 1.8-1.8Z" fill="currentColor" />
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
