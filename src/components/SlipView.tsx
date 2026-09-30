"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Countdown } from "@/components/client";
import { StatusChip, PayChip } from "@/components/chrome";
import { AppBar, Avatar, Hex, LockIcon, Num } from "@/components/ui";
import { PushToggle } from "@/components/PushToggle";
import { iPaid, signOut, removeLeg, restoreLeg, unpay, nudge, markLeg } from "@/app/actions";
import { DkSheet, PlaceSheet } from "@/components/Sheets";
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
      // A new version went live while this page was open: load it fresh
      // rather than feed new data to old screens.
      if (next.build && prev.current.build && next.build !== prev.current.build) {
        window.location.reload();
        return;
      }
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

  // Bookie row: + opens the "I placed it" sheet; DK opens DraftKings (or a sheet first).
  const [sheet, setSheet] = useState<"place" | "dk" | null>(null);
  function tapDk() {
    const p = data.place;
    if (!p.ready) {
      return showSnack({
        text: p.legs === 0 ? "No legs on the slip yet." : `DraftKings opens when all ${p.needed} legs are in (${p.legs}/${p.needed}) or picks lock.`,
      });
    }
    setSheet("dk");
  }
  function stripHere(bare = false) {
    return (
      <BookieStrip
        week={data.week}
        bookie={data.bookie ? { ...data.bookie, odds: totals.final } : null}
        bare={bare}
        place={data.status === "open" || data.status === "locked" ? data.place : null}
        onPlus={() => setSheet("place")}
        onDk={tapDk}
      />
    );
  }

  const [poking, setPoking] = useState(false);
  async function poke() {
    setPoking(true);
    const r = await nudge({}, new FormData());
    setPoking(false);
    showSnack(r.error ? { text: r.error, error: true } : { text: r.ok ?? "Poked" });
  }
  /** Share icon (top right): the phone's share sheet with the slip, or copy it where that isn't available. */
  async function shareSlip() {
    const nav = navigator as Navigator & { share?: (d: { text: string; title?: string }) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: `Week ${data.week} parlay`, text: data.copyText });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // they closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(data.copyText);
    } catch {
      const t = document.createElement("textarea");
      t.value = data.copyText;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    showSnack({ text: "Slip copied. Paste it in the group chat." });
  }

  // Once per phone, the first card you can remove slides left a little to show it swipes.
  const [peekFor, setPeekFor] = useState<string | null>(null);
  useEffect(() => {
    const first = data.rows.find((r) => r.leg && r.canEdit);
    if (!first) return;
    let seen = false;
    try {
      seen = localStorage.getItem("lowball.swipe-peek") === "1";
      localStorage.setItem("lowball.swipe-peek", "1");
    } catch {}
    if (seen) return;
    const t = setTimeout(() => setPeekFor(first.userId), 900);
    return () => clearTimeout(t);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Bookie/admin marks a leg the app can't grade. */
  async function markLive(legId: string, result: "hit" | "miss" | null) {
    const r = await markLeg(legId, result);
    await load();
    showSnack(r.error ? { text: r.error, error: true } : { text: r.ok ?? "Saved" });
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
      <AppBar
        action={
          <button type="button" className="appbar-btn" onClick={shareSlip} aria-label="Share the slip">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M12 3 7.5 7.5l1.4 1.4L11 6.8V15h2V6.8l2.1 2.1 1.4-1.4L12 3Z" fill="currentColor" />
              <path d="M6 10h2v2H6v8h12v-8h-2v-2h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" fill="currentColor" />
            </svg>
          </button>
        }
      />
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
                {totals.final ? "Final" : oddsMoved ? `${formatAmerican(totals.atPick)} at pick` : "Live estimate"}
              </span>
            </div>
            <span className="vs">vs</span>
            <div className="board-side right">
              {/* What DraftKings pays back if it hits (stake included), and each person's share. */}
              <span className="board-label">
                ${Number.isInteger(totals.stake) ? totals.stake : totals.stake.toFixed(2)}{" "}
                {data.status === "won" ? "paid out" : data.status === "lost" ? "would've paid" : "pays out"}
              </span>
              <Num className={`board-big ${data.status === "lost" ? "struck" : ""}`} value={data.winnings.payout} prefix="$" />
              <span className={`board-sub ${data.status === "lost" ? "" : "each-good"}`}>
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
              {data.tally ? (
                <div className="bar bar-tally" aria-hidden="true">
                  <span className="t-hit" style={{ width: `${(data.tally.hit / data.tally.total) * 100}%` }} />
                  <span className="t-push" style={{ width: `${(data.tally.push / data.tally.total) * 100}%` }} />
                  <span className="t-miss" style={{ width: `${(data.tally.miss / data.tally.total) * 100}%` }} />
                </div>
              ) : (
                <div className="bar"><span style={{ width: `${pct}%` }} /></div>
              )}
              <div className="bar-meta">
                {data.tally ? (
                  <span>
                    Hit <b>{data.tally.hit}/{data.tally.total - data.tally.push}</b>
                    {data.tally.miss > 0 && <span className="tally-miss"> · {data.tally.miss} missed</span>}
                  </span>
                ) : (
                  <span>
                    {data.poke.missing > 0 ? "Legs" : "Legs in"} <b>{data.picked}/{data.needed}</b>
                  </span>
                )}
                {data.poke.missing > 0 && (
                  <button type="button" className="poke-chip" onClick={poke} disabled={poking} aria-label={`Poke the ${data.poke.missing} without a leg`}>
                    <span aria-hidden="true">👉</span> {poking ? "…" : "Poke"}
                  </button>
                )}
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
            {d.bookie && (
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
            )}
            {d.funds === data.week ? stripHere() : <BookieStrip week={d.funds} bookie={d.bookie} />}
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
                  <h2 className="team-name">{p.userId === data.me.userId ? "That's you" : p.teamName}</h2>
                  <span className="team-meta">
                    {p.username} · <Num value={data.lastPlace!.points} /> pts
                  </span>
                </div>
                <span className="team-pay"><PayChip state={p.state} amount={data.amount} /></span>
              </div>
              {p.state === "paid" && p.canUndo && (
                <div className="paid-row">
                  <span className="team-foot">
                    Paid{data.bookie ? ` ${data.bookie.isMe ? "you" : data.bookie.teamName}` : ""}
                    {p.paidAt ? ` · ${formatPt(new Date(p.paidAt))}` : ""}
                  </span>
                  <button
                    type="button"
                    className="undo-link"
                    onClick={async () => {
                      await unpay(data.lastPlace!.week, p.userId);
                      await load();
                    }}
                  >
                    Undo
                  </button>
                </div>
              )}
              {stripHere()}
            </section>
          ))}

        {/* No loser on file: still show who's this week's bookie */}
        {!data.myDebts.length && !data.lastPlace && (
          <section className="team-card" aria-label="This week's bookie">
            {stripHere(true)}
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

        <ol className="legs">
          {data.rows.map((row) => {
            const leg = row.leg;
            const d = leg ? delta(leg) : null;
            const f = flash[row.userId];
            return (
              <SwipeTap
                key={`${row.userId}:${leg ? "leg" : "empty"}`}
                className={["leg", row.isMe ? "mine" : "", leg ? "" : "empty", f ? `flash-${f}` : "", leg?.live?.result ? `leg-${leg.live.result}` : ""].join(" ")}
                canTap={leg ? row.canEdit : row.canAdd}
                canSwipe={!!leg && row.canEdit}
                peek={peekFor === row.userId}
                onTap={() => router.push(row.href)}
                onRemove={() => removeRow(row)}
                label={leg ? `Change ${row.isMe ? "your" : `${row.teamName}'s`} leg` : `Add a pick for ${row.isMe ? "yourself" : row.teamName}`}
              >
                <div className="leg-row">
                  <span className={`slot ${leg?.live?.result ? `slot-${leg.live.result}` : ""}`}>
                    {leg?.live?.result === "hit" ? "HIT" : leg?.live?.result === "miss" ? "MISS" : leg?.live?.result === "push" ? "PUSH" : leg ? slotCode(leg.market) : "—"}
                  </span>
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
                {leg && leg.live ? (
                  <LiveStrip live={leg.live} canGrade={data.canGrade} onMark={markLive} />
                ) : leg ? (
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
                ) : null}
              </SwipeTap>
            );
          })}
        </ol>
        {sheet === "dk" && <DkSheet place={data.place} onClose={() => setSheet(null)} />}
        {sheet === "place" && (
          <PlaceSheet
            week={data.week}
            place={data.place}
            losers={data.lastPlace?.people.filter((p) => p.state !== "paid").map((p) => p.teamName) ?? []}
            onClose={() => setSheet(null)}
            onDone={async (msg) => {
              setSheet(null);
              await load();
              showSnack({ text: msg });
            }}
          />
        )}
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


/**
 * "Week 3 bookie". Before it's placed: a ? picture with a green + (tap to record
 * that you placed it) and a DK button (opens the parlay in DraftKings). After:
 * the bookie's picture, name, Venmo and odds.
 */
function BookieStrip({
  week,
  bookie,
  bare = false,
  place = null,
  onPlus,
  onDk,
}: {
  week: number;
  bookie: { teamName: string; avatar: string | null; isMe?: boolean; venmo?: string | null; odds?: number | null } | null;
  bare?: boolean;
  place?: SlipData["place"] | null;
  onPlus?: () => void;
  onDk?: () => void;
}) {
  const open = !bookie && !!place;
  const direct = open && place!.ready && !place!.byHand.length && !place!.early && !!place!.link;
  return (
    <div className={`bookie-strip ${bare ? "bare" : ""}`}>
      {open ? (
        <button type="button" className="bk-claim" onClick={onPlus} aria-label={`I placed it: become the Week ${week} bookie`}>
          <Avatar src={null} name="?" size={40} />
          <span className="plus-badge" aria-hidden="true">+</span>
        </button>
      ) : (
        <Avatar src={bookie?.avatar ?? null} name={bookie ? bookie.teamName : "?"} size={bare ? 44 : 40} />
      )}
      <div>
        <span className="team-kicker">Week {week} bookie</span>
        <b>{bookie ? (bookie.isMe ? "You" : bookie.teamName) : "Not placed yet"}</b>
        {bookie ? (
          (bookie.venmo || bookie.odds != null) && (
            <span className="bookie-hint">
              {[bookie.venmo ? `@${bookie.venmo}` : null, bookie.odds != null ? `placed at ${formatAmerican(bookie.odds)}` : null].filter(Boolean).join(" · ")}
            </span>
          )
        ) : open ? (
          <span className="bookie-hint">Placed it on DraftKings? Tap +</span>
        ) : null}
      </div>
      {open &&
        (direct ? (
          <a className="dk-btn" href={place!.link!} target="_blank" rel="noopener noreferrer" aria-label="Open the parlay in DraftKings">
            DK
          </a>
        ) : (
          <button type="button" className={`dk-btn ${place!.ready ? "" : "dim"}`} onClick={onDk} aria-label="Open the parlay in DraftKings">
            DK
            {!place!.ready && <small>{place!.legs}/{place!.needed}</small>}
          </button>
        ))}
    </div>
  );
}

/**
 * Once a placed leg's game starts: the score and clock, where the leg stands
 * ("62 / 74.5 rec yds · needs 13") with a bar, and HIT / MISS once decided.
 * Legs the app can't grade get Hit / Miss buttons for the bookie or admin.
 */
function LiveStrip({
  live,
  canGrade,
  onMark,
}: {
  live: NonNullable<SlipLeg["live"]>;
  canGrade: boolean;
  onMark: (legId: string, result: "hit" | "miss" | null) => void;
}) {
  const pct = live.progress ? Math.max(0, Math.min(100, (live.progress.current / Math.max(live.progress.target, 0.0001)) * 100)) : null;
  const tone = live.result === "hit" ? "good" : live.result === "miss" ? "bad" : live.result === "push" ? "push" : live.trend ?? "neutral";
  return (
    <div className={`live-strip tone-${tone}`}>
      <div className="live-top">
        <span className="live-score">{live.score ?? ""}</span>
        <span className={`live-clock ${live.state === "in" ? "on" : ""}`}>
          {live.state === "in" && <span className="live-dot" aria-hidden="true" />}
          {live.clock}
        </span>
      </div>
      {(live.text || pct != null) && (
        <div className="live-progress">
          {pct != null && (
            <div className="live-bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          {live.text && <span className="live-text">{live.text}</span>}
        </div>
      )}
      {live.manual && !live.result && (
        canGrade ? (
          <div className="live-mark">
            <span>Can&apos;t track this one automatically:</span>
            <button type="button" className="mark hit" onClick={() => onMark(live.legId, "hit")}>Hit</button>
            <button type="button" className="mark miss" onClick={() => onMark(live.legId, "miss")}>Miss</button>
          </div>
        ) : (
          <div className="live-mark"><span>Tracked by hand: the bookie marks it.</span></div>
        )
      )}
      {live.markedBy === "hand" && live.result && canGrade && (
        <div className="live-mark">
          <span>Marked by hand</span>
          <button type="button" className="mark" onClick={() => onMark(live.legId, null)}>Undo</button>
        </div>
      )}
    </div>
  );
}
