"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Countdown } from "@/components/client";
import { StatusChip, PayChip } from "@/components/chrome";
import { AppBar, Avatar, Hex, LockIcon, Num } from "@/components/ui";
import { PushToggle } from "@/components/PushToggle";
import { iPaid, signOut, removeLeg, restoreLeg } from "@/app/actions";
import { SwipeTap } from "@/components/SwipeTap";
import { useRouter } from "next/navigation";
import type { SlipData, SlipLeg } from "@/lib/slip";
import { americanToDecimal, formatAmerican } from "@/lib/math";
import { slotCode } from "@/lib/lines";
import { formatPt } from "@/lib/weeks";

const POLL_MS = 30_000;


function shortGame(game: string) {
  return game
    .split(" @ ")
    .map((t) => t.trim().split(" ").slice(-1)[0])
    .join(" @ ");
}

function delta(leg: SlipLeg): "up" | "down" | null {
  if (leg.status !== "live" || leg.livePrice == null || leg.pickPrice == null || leg.livePrice === leg.pickPrice) return null;
  return americanToDecimal(leg.livePrice) > americanToDecimal(leg.pickPrice) ? "up" : "down";
}

export function SlipView({ initial, pushKey }: { initial: SlipData; pushKey: string }) {
  const [data, setData] = useState(initial);
  const [flash, setFlash] = useState<Record<string, "up" | "down" | "new">>({});
  const [paying, setPaying] = useState<number | null>(null);
  const prev = useRef(initial);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/slip", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) return;
      const next = (await res.json()) as SlipData;
      const changes: Record<string, "up" | "down" | "new"> = {};
      for (const row of next.rows) {
        const before = prev.current.rows.find((r) => r.userId === row.userId)?.leg;
        if (row.leg && !before) changes[row.userId] = "new";
        else if (row.leg && before && row.leg.livePrice != null && before.livePrice != null && row.leg.livePrice !== before.livePrice) {
          changes[row.userId] = americanToDecimal(row.leg.livePrice) > americanToDecimal(before.livePrice) ? "up" : "down";
        }
      }
      prev.current = next;
      setData(next);
      if (Object.keys(changes).length) {
        setFlash(changes);
        setTimeout(() => setFlash({}), 2400);
      }
    } catch {
      /* offline for a moment; the next poll catches up */
    }
  }, []);

  const [removing, setRemoving] = useState(false);
  const [removeMsg, setRemoveMsg] = useState<string | null>(null);
  async function removeMine() {
    const mine = data.rows.find((r) => r.isMe)?.leg;
    if (!mine || removing) return;
    if (!window.confirm(`Remove your leg (${mine.selection}) from the slip?`)) return;
    setRemoving(true);
    const r = await removeLeg(null);
    setRemoving(false);
    setRemoveMsg(r.error ?? null);
    await load();
  }

  const router = useRouter();
  const [snack, setSnack] = useState<{ text: string; undo?: string; error?: boolean } | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showSnack(next: { text: string; undo?: string; error?: boolean }) {
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSnack(next);
    snackTimer.current = setTimeout(() => setSnack(null), next.undo ? 6000 : 4000);
  }
  /** Swipe left on a card: remove it, with Undo like Gmail. */
  async function removeRow(row: SlipData["rows"][number]) {
    const r = await removeLeg(row.isMe ? null : row.userId);
    await load();
    if (r.error) return showSnack({ text: r.error, error: true });
    showSnack({ text: `Removed ${row.isMe ? "your" : `${row.teamName}'s`} leg`, undo: r.undo });
  }
  async function undoRemove() {
    const token = snack?.undo;
    if (!token) return;
    setSnack(null);
    const r = await restoreLeg(token);
    await load();
    showSnack(r.error ? { text: r.error, error: true } : { text: "Put back on the slip" });
  }

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  const { totals } = data;
  const tracking = data.status === "open" || data.status === "locked";
  const shownOdds = totals.final ?? (tracking ? totals.live : null) ?? totals.atPick;
  const oddsMoved = !totals.final && tracking && totals.atPick != null && totals.live != null && totals.atPick !== totals.live;
  const oddsBetter = oddsMoved && americanToDecimal(totals.live!) > americanToDecimal(totals.atPick!);
  const myRow = data.rows.find((r) => r.isMe);
  // Picking is over once it's locked or placed.
  const canPick = data.me.picks && !data.locked && data.status === "open";
  const pct = data.needed ? Math.round((data.picked / data.needed) * 100) : 0;

  return (
    <>
      <AppBar />
      <main className="wrap">
        <div className="pill-row">
          <span className="beige-pill">The Slip</span>
          <span className="beige-pill">Week {data.week}</span>
        </div>

        {pushKey && data.me.inPool && <PushToggle publicKey={pushKey} />}

        {/* Scoreboard card, like a matchup */}
        <section className="board-card" aria-label="Parlay">
          <div className="board-top">
            <div className="board-side">
              <span className="board-label">Parlay odds</span>
              <span className="board-big">{formatAmerican(shownOdds)}</span>
              <span className={`board-sub ${oddsMoved ? (oddsBetter ? "good" : "bad") : ""}`}>
                {totals.final ? "Final" : oddsMoved ? `${formatAmerican(totals.atPick)} at pick` : "Live"}
                {" · "}
                <Num value={totals.stake} prefix="$" /> stake
              </span>
            </div>
            <span className="vs">vs</span>
            <div className="board-side right">
              {/* What DraftKings pays back if it hits (stake included), and each person's share. */}
              <span className="board-label">{data.status === "won" ? "Paid" : "Pays"}</span>
              <Num className="board-big" value={data.winnings.payout} prefix="$" />
              <span className="board-sub each-good">
                {data.winnings.perPerson != null ? (
                  <>
                    <Num value={data.winnings.perPerson} prefix="$" /> each
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
          </div>
          <div className="board-bars">
            <div className="bar-block">
              <div className="bar"><span style={{ width: `${pct}%` }} /></div>
              <div className="bar-meta">
                <span>Legs in</span>
                <b>{data.picked}/{data.needed}</b>
              </div>
            </div>
            <div className="bar-block">
              <div className="bar"><span style={{ width: data.locked ? "100%" : "0%" }} className="bar-lock" /></div>
              <div className="bar-meta">
                <StatusChip status={data.status} />
                <b>{data.status === "open" ? <Countdown to={data.lock} /> : formatPt(new Date(data.lock))}</b>
              </div>
            </div>
          </div>
        </section>

        {/* Last place, like the team header */}
        {data.myDebts.map((d) => (
          <section className="team-card owe" key={d.week} aria-label="You owe">
            <div className="team-head">
              <span className="team-av">
                <Avatar src={data.me.avatar} name={data.me.teamName} size={64} />
                <Hex>{data.leagueSize}</Hex>
              </span>
              <div>
                <span className="team-kicker">Last place · Week {d.week}</span>
                <h2 className="team-name">That&apos;s you</h2>
                <span className="team-meta"><Num value={d.points} /> pts · {d.tied ? "tied for last" : "lowest score"}</span>
              </div>
            </div>
            <BookieStrip week={d.funds} bookie={d.bookie} />
            {!d.bookie ? (
              <p className="team-foot">
                ${data.amount} goes to whoever places the Week {d.funds} parlay. Your Pay button shows up here as soon as someone does.
              </p>
            ) : (
              <>
                <div className={`team-actions ${d.venmoUrl ? "" : "one"}`}>
                  {d.venmoUrl && (
                    <a className="btn btn-green" href={d.venmoUrl} target="_blank" rel="noopener noreferrer">
                      Pay ${data.amount} on Venmo
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-glass"
                    disabled={paying === d.week}
                    onClick={async () => {
                      setPaying(d.week);
                      await iPaid(d.week);
                      await load();
                      setPaying(null);
                    }}
                  >
                    {paying === d.week ? "Saving…" : "I paid"}
                  </button>
                </div>
                <p className="team-foot">
                  {d.venmoUrl
                    ? `${d.bookie.teamName} placed Week ${d.funds}, so they're the bookie. Venmo opens with @${d.bookie.venmo}, $${data.amount} and the note filled in.`
                    : `${d.bookie.teamName} placed Week ${d.funds} but hasn't added a Venmo yet. Pay them however you like, then tap I paid.`}
                </p>
              </>
            )}
          </section>
        ))}

        {data.lastPlace && !data.myDebts.some((d) => d.week === data.lastPlace!.week) &&
          data.lastPlace.people.map((p) => (
            <section className="team-card" key={p.userId} aria-label="Last place">
              <div className="team-head">
                <span className="team-av">
                  <Avatar src={p.avatar} name={p.teamName} size={64} />
                  <Hex>{data.leagueSize}</Hex>
                </span>
                <div>
                  <span className="team-kicker">Last place · Week {data.lastPlace!.week}</span>
                  <h2 className="team-name">{p.teamName}</h2>
                  <span className="team-meta">
                    {p.username} · <Num value={data.lastPlace!.points} /> pts
                  </span>
                </div>
                <span className="team-pay"><PayChip state={p.state} amount={data.amount} /></span>
              </div>
              <BookieStrip week={data.week} bookie={data.bookie} />
            </section>
          ))}

        {/* No loser on file: still show who's this week's bookie */}
        {!data.myDebts.length && !data.lastPlace && (
          <section className="team-card" aria-label="This week's bookie">
            <BookieStrip week={data.week} bookie={data.bookie} bare />
          </section>
        )}

        {/* Big "Optimize"-style button (old NFL Fantasy app) when your slot is empty */}
        {myRow && !myRow.leg && canPick && (
          <div className="opt-wrap">
            <Link href="/search" className="opt-btn">
              <span className="opt-num">{data.picked}/{data.needed}</span>
              <span className="opt-label">Add your leg</span>
            </Link>
          </div>
        )}

        <h2 className="section-label">Legs</h2>
        {data.rows.some((r) => r.canEdit || r.canAdd) && (
          <p className="legs-hint">
            <span>Tap a raised card to {data.rows.some((r) => r.canAdd) ? "change or add a pick" : "change it"}</span>
            {data.rows.some((r) => r.canEdit) && (
              <span className="nowrap">
                · <span className="edge edge-remove" aria-hidden="true" /> swipe left to remove
              </span>
            )}
          </p>
        )}

        <ol className="legs">
          {data.rows.map((row) => {
            const leg = row.leg;
            const d = leg ? delta(leg) : null;
            const f = flash[row.userId];
            return (
              <SwipeTap
                key={`${row.userId}:${leg ? "leg" : "empty"}`}
                className={["leg", row.isMe ? "mine" : "", leg ? "" : "empty", f ? `flash-${f}` : ""].join(" ")}
                canTap={leg ? row.canEdit : row.canAdd}
                canSwipe={!!leg && row.canEdit}
                onTap={() => router.push(row.href)}
                onRemove={() => removeRow(row)}
                label={leg ? `Change ${row.isMe ? "your" : `${row.teamName}'s`} leg` : `Add a pick for ${row.isMe ? "yourself" : row.teamName}`}
              >
                <div className="leg-row">
                  <span className="slot">{leg ? slotCode(leg.market) : "—"}</span>
                  <Avatar src={row.avatar} name={row.teamName} size={42} />
                  <div className="leg-main">
                    {leg ? (
                      <>
                        <strong className="sel">{leg.selection}</strong>
                        <span className="leg-sub">
                          <span className="who">{row.teamName}{row.isMe && " (you)"}</span>
                          {" "}
                          {leg.enteredBy ? (
                            <span className="entered">· Entered by {leg.enteredBy}</span>
                          ) : (
                            <span className="own-pick">· <LockIcon /> Own pick</span>
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong className="sel empty-sel">Empty</strong>
                        <span className="leg-sub">{row.teamName}{row.isMe && " (you)"}</span>
                      </>
                    )}
                  </div>
                  <div className="leg-price">
                    {leg ? (
                      <>
                        <b>{formatAmerican(leg.status === "live" ? leg.livePrice : leg.pickPrice)}</b>
                        {d && <small className={d === "up" ? "good" : "bad"}>{formatAmerican(leg.pickPrice)}</small>}
                      </>
                    ) : row.canAdd ? (
                      <span className="add-circle" aria-hidden="true">
                        <svg viewBox="0 0 18 18" width="18" height="18" style={{ display: "block" }}><path d="M9 2v14M2 9h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
                      </span>
                    ) : (
                      <b className="dash">—</b>
                    )}
                  </div>
                </div>
                {leg && (
                  <div className="leg-strip">
                    <span>
                      {leg.market === "custom" ? leg.game : shortGame(leg.game)}
                      {leg.kickoff && ` · ${formatPt(new Date(leg.kickoff), { weekday: "short", hour: "numeric", minute: "2-digit" })}`}
                    </span>
                    {leg.dropsAt ? (
                      <span className="pill pill-amber" title="Early game: this leg comes off unless the parlay is placed by then">
                        Drops {formatPt(new Date(leg.dropsAt), { weekday: "short", hour: "numeric", minute: "2-digit" })}
                      </span>
                    ) : leg.status === "moved" && leg.movedTo ? (
                      <span className="pill pill-amber" title={`DraftKings main line is now ${leg.movedTo} (${formatAmerican(leg.livePrice)})`}>
                        Line now {leg.movedPoint == null ? leg.movedTo : leg.market === "spreads" && leg.movedPoint > 0 ? `+${leg.movedPoint}` : leg.movedPoint}
                      </span>
                    ) : leg.status === "gone" ? (
                      <span className="pill pill-grey">Off board</span>
                    ) : leg.status === "live" ? (
                      <span className="pill pill-green">Live</span>
                    ) : leg.status === "custom" ? (
                      <span className="pill pill-grey">By hand</span>
                    ) : null}
                  </div>
                )}
              </SwipeTap>
            );
          })}
        </ol>
        {snack && (
          <div className={`snack ${snack.error ? "snack-bad" : ""}`} role="status">
            <span>{snack.text}</span>
            {snack.undo && (
              <button type="button" className="snack-undo" onClick={undoRemove}>
                Undo
              </button>
            )}
          </div>
        )}

        {/* The opposite of Add your leg: at the bottom, away from the legs, so it's hard to hit by accident */}
        {myRow?.leg && data.me.canRemove && (
          <div className="opt-wrap opt-wrap-bottom">
            <button type="button" className="opt-btn opt-red" onClick={removeMine} disabled={removing}>
              <span className="opt-num" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="24" height="24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" fill="currentColor" /></svg>
              </span>
              <span className="opt-label">{removing ? "Removing…" : "Remove your leg"}</span>
            </button>
          </div>
        )}
        {removeMsg && <p className="fine center bad" role="status">{removeMsg}</p>}
        {!data.me.inPool && (
          <p className="fine center">You&apos;re not in the pool this season. Ask {data.payTo.teamName ?? "the admin"} to add you.</p>
        )}
        {data.me.inPool && !data.me.picks && data.status === "open" && (
          <p className="fine center">You&apos;re funding this one, so you sit this week out.</p>
        )}

        <p className="fine center">
          {totals.final
            ? `Final DraftKings odds.${data.parlayNote ? ` ${data.parlayNote}` : ""}`
            : tracking && data.odds.at
              ? `DraftKings prices as of ${formatPt(new Date(data.odds.at), { weekday: undefined })}. Updates on its own. Same-game legs get repriced by DraftKings, so the placed number can differ.`
              : "Prices from when each leg was picked."}
          {data.odds.stale && " Odds feed is lagging, so these are the last prices we got."}
          {totals.unpriced > 0 && ` ${totals.unpriced} leg${totals.unpriced > 1 ? "s" : ""} without odds not counted.`}
        </p>

        {data.liveLast && (
          <div className="live-last">
            <span className="pill pill-red">On pace for last</span>
            <span>{data.liveLast.teamName}</span>
            <Num value={data.liveLast.points} />
          </div>
        )}

        <footer className="foot">
          <form action={signOut}>
            <span>Signed in as {data.me.teamName} · </span>
            <button type="submit" className="btn-link">Sign out</button>
          </form>
          <p>iPhone: Share → Add to Home Screen. Android: menu → Install app.</p>
        </footer>
      </main>
    </>
  );
}


/** "Week 3 bookie": a ? until someone taps I placed it, then their picture and name. */
function BookieStrip({
  week,
  bookie,
  bare = false,
}: {
  week: number;
  bookie: { teamName: string; avatar: string | null; isMe?: boolean } | null;
  bare?: boolean;
}) {
  return (
    <div className={`bookie-strip ${bare ? "bare" : ""}`}>
      <Avatar src={bookie?.avatar ?? null} name={bookie ? bookie.teamName : "?"} size={bare ? 44 : 34} />
      <div>
        <span className="team-kicker">Week {week} bookie</span>
        <b>{bookie ? (bookie.isMe ? "You" : bookie.teamName) : "Not placed yet"}</b>
        {!bookie && <span className="bookie-hint">Whoever places it on DraftKings</span>}
      </div>
    </div>
  );
}
