"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Countdown } from "@/components/client";
import { StatusChip, PayChip } from "@/components/chrome";
import { AppBar, Avatar, Hex, Num } from "@/components/ui";
import { PushToggle } from "@/components/PushToggle";
import { iPaid, signOut, removeLeg } from "@/app/actions";
import type { SlipData, SlipLeg } from "@/lib/slip";
import { americanToDecimal, formatAmerican } from "@/lib/math";
import { formatPt } from "@/lib/weeks";

const POLL_MS = 30_000;

const SLOT: Record<string, string> = {
  spreads: "SPR",
  h2h: "ML",
  totals: "TOT",
  player_anytime_td: "TD",
  player_pass_yds: "PASS",
  player_rush_yds: "RUSH",
  player_reception_yds: "REC",
  custom: "BET",
};

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
  const canPick = data.me.picks && !data.locked;
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
                {totals.final ? (data.placedBy ? `Placed by ${data.placedBy}` : "Final from DraftKings") : oddsMoved ? `${formatAmerican(totals.atPick)} at pick` : "Live estimate"}
              </span>
            </div>
            <span className="vs">vs</span>
            <div className="board-side right">
              <span className="board-label">To win</span>
              <Num className="board-big" value={totals.toWin} prefix="$" />
              <span className="board-sub">
                <Num value={totals.stake} prefix="$" /> stake
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
            {d.venmoUrl ? (
              <>
                <div className="team-actions">
                  <a className="btn btn-green" href={d.venmoUrl} target="_blank" rel="noopener noreferrer">
                    Pay ${data.amount} on Venmo
                  </a>
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
                <p className="team-foot">Venmo opens with @{data.payTo.venmo}, ${data.amount} and the note filled in.</p>
              </>
            ) : (
              <>
                <div className="team-actions one">
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
                    {paying === d.week ? "Saving…" : "Mark my $" + data.amount + " as in"}
                  </button>
                </div>
                <p className="team-foot">You hold the pot, so there&apos;s nothing to send.</p>
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
            </section>
          ))}

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

        <ol className="legs">
          {data.rows.map((row) => {
            const leg = row.leg;
            const d = leg ? delta(leg) : null;
            const f = flash[row.userId];
            return (
              <li
                key={row.userId}
                className={["leg", row.isMe ? "mine" : "", leg ? "" : "empty", f ? `flash-${f}` : ""].join(" ")}
              >
                <div className="leg-row">
                  <span className="slot">{leg ? SLOT[leg.market] ?? "BET" : "—"}</span>
                  <Avatar src={row.avatar} name={row.teamName} size={42} />
                  <div className="leg-main">
                    {leg ? (
                      <>
                        <strong className="sel">{leg.selection}</strong>
                        <span className="leg-sub">
                          {row.teamName}
                          {row.isMe && " (you)"}
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
                    ) : (
                      <b className="dash">—</b>
                    )}
                  </div>
                </div>
                {leg && (
                  <div className="leg-strip">
                    <span>
                      {leg.enteredBy && <span className="entered">Entered by {leg.enteredBy} · </span>}
                      {leg.market === "custom" ? leg.game : shortGame(leg.game)}
                      {leg.kickoff && ` · ${formatPt(new Date(leg.kickoff), { weekday: "short", hour: "numeric", minute: "2-digit" })}`}
                    </span>
                    {leg.status === "moved" && leg.movedTo ? (
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
              </li>
            );
          })}
        </ol>

        {/* Winnings under the slip */}
        <section className="win-card" aria-label="Winnings">
          <div className="win-grid">
            <div className="win-col">
              <span className="board-label">{data.status === "won" ? `Week ${data.week} paid` : `If Week ${data.week} hits`}</span>
              <Num className="win-big" value={data.winnings.payout} prefix="$" />
              <span className="win-each">
                {data.winnings.perPerson != null ? (
                  <>
                    <Num value={data.winnings.perPerson} prefix="$" /> each
                  </>
                ) : (
                  "—"
                )}
                <span className="muted" style={{ fontWeight: 600 }}> · {data.winnings.split} players</span>
              </span>
            </div>
            <div className="win-col right">
              <span className="board-label">Season won</span>
              <Num className="win-big" value={data.winnings.season.total} prefix="$" />
              <span className={`win-each ${data.winnings.season.hits ? "" : "muted"}`}>
                <Num value={data.winnings.season.perPerson} prefix="$" /> each
                <span className="muted" style={{ fontWeight: 600 }}> · {data.winnings.season.hits} hit{data.winnings.season.hits === 1 ? "" : "s"}</span>
              </span>
            </div>
          </div>
          <p className="fine">Payout includes the stake. Split evenly across everyone on that week&apos;s slip.</p>
        </section>

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

