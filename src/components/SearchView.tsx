"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionForm, Countdown, Submit } from "@/components/client";
import { AppBar } from "@/components/ui";
import { pickBoardLine, pickCustom } from "@/app/actions";
import { cutoffFor, isEarly } from "@/lib/legrules";
import type { BoardData, BoardGame, BoardLeg } from "@/lib/board";
import { conflictFor, isPropMarket, MARKET_LABEL, shortTeam, type BoardLine } from "@/lib/lines";
import { formatAmerican } from "@/lib/math";
import { formatPt } from "@/lib/weeks";

const CHIPS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "spreads", label: "Spreads" },
  { id: "h2h", label: "Moneylines" },
  { id: "totals", label: "Totals" },
  { id: "player_anytime_td", label: "Anytime TD" },
  { id: "player_pass_yds", label: "Pass yds" },
  { id: "player_rush_yds", label: "Rush yds" },
  { id: "player_reception_yds", label: "Rec yds" },
  { id: "player_receiving_receptions", label: "Receptions" },
  { id: "more", label: "More props" },
];
const CHIP_IDS = new Set(CHIPS.map((c) => c.id));
/** A line matches a chip; "More props" is every prop without its own chip. */
function inChip(market: string, chip: string) {
  if (chip === "all") return true;
  if (chip === "more") return isPropMarket(market) && !CHIP_IDS.has(market);
  return market === chip;
}
const MAX_RESULTS = 80;

function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+.\- ]/g, " ");
}

function haystack(l: BoardLine) {
  const extra =
    l.market === "player_anytime_td" ? "td touchdown" :
    l.market === "h2h" ? "ml moneyline win" :
    l.market === "totals" ? "total points" :
    l.market === "player_reception_yds" ? "rec receiving" :
    l.market === "player_rush_yds" ? "rush rushing" :
    l.market === "player_pass_yds" ? "pass passing" :
    l.market === "spreads" ? "spread" : "";
  return norm(`${l.label} ${l.game} ${extra} ${MARKET_LABEL[l.market]}`);
}

type Toast = { kind: "ok" | "error"; text: string } | null;

export function SearchView({ initial }: { initial: BoardData }) {
  const [legs, setLegs] = useState<BoardLeg[]>(initial.legs);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");
  const [gameFilter, setGameFilter] = useState<string | null>(null);
  const [props, setProps] = useState<BoardLine[] | null>(null);
  const [propsState, setPropsState] = useState<"idle" | "loading" | "error">("idle");
  const [propsError, setPropsError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const target = initial.target;
  const forUser = initial.forOther ? target.userId : null;
  const myLeg = legs.find((l) => l.userId === target.userId) ?? null;
  const others = useMemo(() => legs.filter((l) => l.userId !== target.userId), [legs, target.userId]);
  const canPick = initial.canPick;

  const q = norm(query).trim();
  const needProps = q.length >= 2 || chip.startsWith("player_") || chip === "more" || gameFilter != null;

  const refreshLegs = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      if (res.ok) setLegs((await res.json()).legs);
    } catch {
      /* try again next tick */
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && refreshLegs(), 45_000);
    return () => clearInterval(t);
  }, [refreshLegs]);

  useEffect(() => {
    if (!needProps || props || propsState !== "idle" || !initial.propsEnabled) return;
    setPropsState("loading");
    fetch("/api/board?props=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.legs) setLegs(j.legs);
        if (j.error && !(j.props ?? []).length) throw new Error(j.error);
        setProps(j.props ?? []);
        setPropsState("idle");
      })
      .catch((err) => {
        setPropsError((err as Error).message);
        setPropsState("error");
      });
  }, [needProps, props, propsState, initial.propsEnabled]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  function lineState(l: BoardLine) {
    const mine = myLeg?.key === l.key;
    const clash = mine ? null : conflictFor({ eventId: l.eventId, market: l.market, desc: l.desc || null }, others);
    return { mine, takenBy: clash ? others.find((o) => o.userId === clash.userId)?.teamName ?? "Someone" : null };
  }

  async function pick(l: BoardLine) {
    if (!canPick || pending) return;
    setPending(l.key);
    const swapping = !!myLeg && !initial.forOther;
    const r = await pickBoardLine({ eventId: l.eventId, market: l.market, name: l.name, desc: l.desc, point: l.point, forUser });
    setPending(null);
    if (r.error) {
      setToast({ kind: "error", text: r.error });
      refreshLegs();
      return;
    }
    setLegs((prev) => [
      ...prev.filter((x) => x.userId !== target.userId),
      { userId: target.userId, teamName: target.teamName, eventId: l.eventId, market: l.market, desc: l.desc || null, key: r.key ?? l.key, selection: l.label, price: l.price, enteredBy: initial.forOther ? initial.meId : null },
    ]);
    setToast({ kind: "ok", text: swapping ? `Swapped to ${l.label}` : r.ok ?? "On the slip" });
    // Picking for someone else: back to the Bookie tab for the next name.
    if (initial.forOther) setTimeout(() => (window.location.href = "/bookie"), 1400);
  }

  const browsing = !q && chip === "all" && !gameFilter;
  const results = useMemo(() => {
    if (browsing) return null;
    const pool = [...initial.games.flatMap((g) => g.lines), ...(props ?? [])];
    const tokens = q.split(/\s+/).filter(Boolean);
    const matched = pool.filter(
      (l) =>
        inChip(l.market, chip) &&
        (!gameFilter || l.eventId === gameFilter) &&
        tokens.every((t) => haystack(l).includes(t)),
    );
    const order = new Map(initial.games.map((g, i) => [g.eventId, i]));
    const marketOrder = (m: string) => {
      const i = CHIPS.findIndex((c) => c.id === m);
      return i < 0 ? 99 : i;
    };
    matched.sort(
      (a, b) =>
        (order.get(a.eventId) ?? 99) - (order.get(b.eventId) ?? 99) ||
        marketOrder(a.market) - marketOrder(b.market) ||
        a.desc.localeCompare(b.desc) ||
        a.name.localeCompare(b.name),
    );
    return { total: matched.length, lines: matched.slice(0, MAX_RESULTS) };
  }, [browsing, initial.games, props, q, chip, gameFilter]);

  const grouped = useMemo(() => {
    if (!results) return [];
    const groups: Array<{ eventId: string; game: string; commence: string; lines: BoardLine[] }> = [];
    for (const l of results.lines) {
      let g = groups.find((x) => x.eventId === l.eventId);
      if (!g) groups.push((g = { eventId: l.eventId, game: l.game, commence: l.commence, lines: [] }));
      g.lines.push(l);
    }
    return groups;
  }, [results]);

  const filterGame = initial.games.find((g) => g.eventId === gameFilter);

  return (
    <>
    <AppBar />
    <main className="wrap">
      <div className="pill-row">
        <span className="beige-pill">Find a bet</span>
        <span className="beige-pill">Week {initial.week}</span>
      </div>
      <p className="fine">
        {initial.locked
          ? `Picks locked ${formatPt(new Date(initial.lock))}.`
          : <>Locks {formatPt(new Date(initial.lock))} · <Countdown to={initial.lock} /> · DraftKings lines for games after the lock</>}
      </p>

      {initial.forOther && (
        <div className="for-banner" role="status">
          <span>
            Picking for <b>{target.teamName}</b>
          </span>
          <a href="/search" className="for-cancel" aria-label={`Stop picking for ${target.teamName}, back to your own leg`}>
            ✕
          </a>
        </div>
      )}

      {/* Your current pick shows highlighted in the lines below; tap another to swap.
          Removing lives on The Slip. Only say something when picking isn't possible. */}
      {!canPick && (
        <p className="fine" role="status">
          {initial.forOther
            ? `${target.teamName} isn't in the pool, or picked their own leg (only they can change it).`
            : initial.locked
              ? "Picks are locked for this week."
              : "You're not picking this week (not in the pool, or funding this one)."}
        </p>
      )}

      <div className="searchbar">
        <input
          id="q"
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Search a team or player"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search bets"
        />
        <div className="chips" role="group" aria-label="Bet type">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip-btn"
              aria-pressed={chip === c.id}
              onClick={() => setChip(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {filterGame && (
          <button type="button" className="chip-btn active-filter" onClick={() => setGameFilter(null)}>
            {shortTeam(filterGame.away)} @ {shortTeam(filterGame.home)} ✕
          </button>
        )}
      </div>

      {initial.oddsNote && <p className="notice">{initial.oddsNote}</p>}
      {needProps && !initial.propsEnabled && (
        <p className="notice">Player prop search is off (no SportsGameOdds key). Add props by hand below.</p>
      )}

      {browsing ? (
        initial.games.length ? (
          initial.games.map((g) => (
            <GameCard
              key={g.eventId}
              game={g}
              lock={initial.lock}
              lineState={lineState}
              pending={pending}
              disabled={!canPick}
              onPick={pick}
              onProps={() => setGameFilter(g.eventId)}
            />
          ))
        ) : (
          initial.oddsEnabled && !initial.oddsNote && <p className="notice">DraftKings hasn&apos;t posted lines for this week&apos;s games yet.</p>
        )
      ) : (
        <section className="results" aria-label="Results">
          {needProps && propsState === "loading" && <p className="fine">Loading player props…</p>}
          {propsState === "error" && <p className="notice">Couldn&apos;t load player props: {propsError}</p>}
          {results && results.total === 0 && propsState !== "loading" && (
            <p className="small muted">Nothing matches. Try a last name, a team, or add it by hand below.</p>
          )}
          {grouped.map((g) => (
            <div className="result-group" key={g.eventId}>
              <h2 className="group-title">
                {g.game.split(" @ ").map(shortTeam).join(" @ ")}
                <span className="muted"> · {formatPt(new Date(g.commence))}</span>
              </h2>
              {g.lines.map((l) => {
                const s = lineState(l);
                return (
                  <button
                    key={l.key}
                    type="button"
                    className="result"
                    data-mine={s.mine}
                    disabled={!canPick || !!s.takenBy || s.mine || pending === l.key}
                    onClick={() => pick(l)}
                  >
                    <span className="r-main">
                      <span className="r-label">{l.label}</span>
                      <span className="r-meta">
                        {MARKET_LABEL[l.market]}
                        {s.mine && " · on your slip"}
                        {s.takenBy && ` · taken by ${s.takenBy}`}
                      </span>
                    </span>
                    <span className="r-price mono">{pending === l.key ? "…" : formatAmerican(l.price)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {results && results.total > MAX_RESULTS && (
            <p className="small muted">Showing {MAX_RESULTS} of {results.total}. Keep typing to narrow it down.</p>
          )}
        </section>
      )}

      {canPick && (
        <details className="custom" id="custom">
          <summary>Can&apos;t find it? Add a bet by hand</summary>
          <p className="small muted">Alt lines, other props, anything on DraftKings. Copy the odds from the app if you have them.</p>
          <ActionForm action={pickCustom} className="stack" resetOnSuccess onSuccess={() => (initial.forOther ? setTimeout(() => (window.location.href = "/bookie"), 1400) : refreshLegs())}>
            <input type="hidden" name="forUser" value={forUser ?? ""} />
            <div className="field">
              <label htmlFor="selection">The bet</label>
              <input id="selection" name="selection" placeholder="Kenneth Walker III 70+ rushing yards" maxLength={120} required />
            </div>
            <div className="field">
              <label htmlFor="game">Game</label>
              {initial.games.length > 0 ? (
                // Only games still open for picks (15+ minutes before kickoff), so
                // Thursday's game is gone by Friday.
                <select id="game" name="eventId" required defaultValue="">
                  <option value="" disabled>Pick a game</option>
                  {initial.games.map((g) => (
                    <option key={g.eventId} value={g.eventId}>
                      {g.away.split(" ").slice(-1)[0]} @ {g.home.split(" ").slice(-1)[0]} · {formatPt(new Date(g.commence))}
                    </option>
                  ))}
                </select>
              ) : (
                <input id="game" name="game" placeholder="Seahawks @ Cardinals" maxLength={80} required />
              )}
            </div>
            <OddsField />
            <Submit>Put it on the slip</Submit>
          </ActionForm>
        </details>
      )}

      {initial.oddsAt && (
        <p className="fine center">DraftKings lines as of {formatPt(new Date(initial.oddsAt))}. Your leg keeps the price you tapped; The Slip shows where it moves.</p>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          <span>{toast.text}</span>
          {toast.kind === "ok" && <Link href="/">See the slip</Link>}
        </div>
      )}
    </main>
    </>
  );
}

function GameCard({
  game, lock, lineState, pending, disabled, onPick, onProps,
}: {
  game: BoardGame;
  lock: string;
  lineState: (l: BoardLine) => { mine: boolean; takenBy: string | null };
  pending: string | null;
  disabled: boolean;
  onPick: (l: BoardLine) => void;
  onProps: () => void;
}) {
  const find = (market: string, name: string) => game.lines.find((l) => l.market === market && l.name === name);
  const rows = [
    { team: game.away, spread: find("spreads", game.away), total: find("totals", "Over"), ml: find("h2h", game.away) },
    { team: game.home, spread: find("spreads", game.home), total: find("totals", "Under"), ml: find("h2h", game.home) },
  ];
  const taken = new Map<string, string>();
  for (const l of game.lines) {
    const s = lineState(l);
    if (s.takenBy) taken.set(MARKET_LABEL[l.market], s.takenBy);
  }

  const Cell = ({ line, top }: { line?: BoardLine; top?: string }) => {
    if (!line) return <span className="cell cell-empty">—</span>;
    const s = lineState(line);
    return (
      <button
        type="button"
        className="cell"
        data-mine={s.mine}
        disabled={disabled || !!s.takenBy || s.mine || pending === line.key}
        onClick={() => onPick(line)}
        aria-label={`${line.label} ${formatAmerican(line.price)}${s.takenBy ? `, taken by ${s.takenBy}` : ""}${s.mine ? ", on your slip" : ""}`}
        title={s.takenBy ? `Taken by ${s.takenBy}` : undefined}
      >
        {top && <span className="cell-top">{top}</span>}
        <span className="cell-price mono">{pending === line.key ? "…" : formatAmerican(line.price)}</span>
      </button>
    );
  };
  const sign = (n: number | null) => (n == null ? "" : n > 0 ? `+${n}` : `${n}`);

  return (
    <section className="game" aria-label={game.game}>
      <div className="game-head">
        <span className="small muted">
          {formatPt(new Date(game.commence))}
          {isEarly(game.commence, new Date(lock)) && (
            <span className="early-note"> · Early game: drops at {formatPt(cutoffFor(game.commence), { weekday: undefined })} unless placed</span>
          )}
        </span>
        <span className="game-cols" aria-hidden="true">
          <span>Spread</span><span>Total</span><span>Money</span>
        </span>
      </div>
      {rows.map((r, i) => (
        <div className="game-row" key={r.team}>
          <span className="team">{r.team}</span>
          <Cell line={r.spread} top={sign(r.spread?.point ?? null)} />
          <Cell line={r.total} top={r.total ? `${i === 0 ? "O" : "U"} ${r.total.point}` : undefined} />
          <Cell line={r.ml} />
        </div>
      ))}
      <div className="game-foot">
        {taken.size > 0 && (
          <span className="small muted">
            Taken: {[...taken].map(([m, who]) => `${m.toLowerCase()} (${who})`).join(", ")}
          </span>
        )}
        <button type="button" className="btn-link" onClick={onProps}>Player props →</button>
      </div>
    </section>
  );
}

/** Odds with a +/− switch: phone number pads have no minus key. */
function OddsField() {
  const [sign, setSign] = useState<"-" | "+">("-");
  const [digits, setDigits] = useState("");
  const box = useRef<HTMLInputElement>(null);
  // Clear along with the rest of the form after a successful add.
  useEffect(() => {
    const form = box.current?.form;
    if (!form) return;
    const clear = () => { setDigits(""); setSign("-"); };
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);
  return (
    <div className="field">
      <label htmlFor="price-digits">Odds (optional)</label>
      <div className="odds-field">
        <div className="sign-toggle" role="radiogroup" aria-label="Odds sign">
          {(["-", "+"] as const).map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={sign === x}
              className={sign === x ? "on" : ""}
              onClick={() => setSign(x)}
            >
              {x === "-" ? "−" : "+"}
            </button>
          ))}
        </div>
        <input
          ref={box}
          id="price-digits"
          inputMode="numeric"
          placeholder={sign === "-" ? "110" : "135"}
          value={digits}
          onChange={(e) => {
            const raw = e.target.value.trim();
            // Typing or pasting "-115" / "+240" sets the sign too.
            if (raw.startsWith("-") || raw.startsWith("−")) setSign("-");
            else if (raw.startsWith("+")) setSign("+");
            setDigits(raw.replace(/[^0-9]/g, "").slice(0, 6));
          }}
        />
      </div>
      <input type="hidden" name="price" value={digits ? `${sign}${digits}` : ""} />
    </div>
  );
}
