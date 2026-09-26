import { PayChip } from "@/components/chrome";
import { BottomNav } from "@/components/nav";
import { AppBar, Avatar, Num } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client";
import { RecordGrid, type RecordWeek } from "@/components/RecordGrid";
import { confirmPayment, setPoolMember, recomputeLoser, setVenmo } from "@/app/actions";
import { venmos } from "@/lib/venmos";
import { seasonWinnings } from "@/lib/winnings";
import { requireMember } from "@/lib/session";
import { seasonNow } from "@/lib/season";
import { getLosers, getParlays } from "@/lib/db";
import { config } from "@/lib/config";
import { avatarUrl } from "@/lib/sleeper";

export const dynamic = "force-dynamic";

const SEASON_WEEKS = 18;

// Season-long stuff: parlay record, who's in, and who has paid.

export default async function LeaguePage() {
  const { me, all } = await requireMember();
  const now = await seasonNow();
  const admin = all.find((m) => m.isAdmin);
  const [parlays, losers, handles] = await Promise.all([
    getParlays(now.season),
    getLosers(now.season),
    venmos(admin?.userId).catch(() => new Map<string, string>()),
  ]);
  const byId = new Map(all.map((m) => [m.userId, m]));
  const byWeek = new Map(parlays.map((p) => [p.week, p]));

  const weeks: RecordWeek[] = Array.from({ length: SEASON_WEEKS }, (_, i) => {
    const w = i + 1;
    const p = byWeek.get(w);
    const funders = losers.filter((l) => l.week === w - 1).map((l) => byId.get(l.user_id)?.teamName ?? "?");
    return {
      week: w,
      status: p?.status ?? "open",
      dkOdds: p?.dk_odds ?? null,
      stake: p?.stake != null ? Number(p.stake) : null,
      payout: p?.payout != null ? Number(p.payout) : null,
      placedBy: p?.placed_by ? byId.get(p.placed_by)?.teamName ?? null : null,
      loser: funders.length ? funders.join(" & ") : null,
      current: w === now.week,
      future: w > now.week,
    };
  });
  const won = parlays.filter((p) => p.status === "won").length;
  const season = await seasonWinnings(now.season, parlays);
  const lost = parlays.filter((p) => p.status === "lost").length;
  const inPool = all.filter((m) => m.inPool).length;

  return (
    <>
      <AppBar />
      <main className="wrap">
        <div className="pill-row">
          <span className="beige-pill">League</span>
          <span className="beige-pill">{now.season} season</span>
        </div>

        {/* 1. Parlay record */}
        <section className="card">
          <div className="card-head">
            <h2 className="h-section">Parlay record</h2>
            <span className="record-score">
              <b>{won}</b>–<b>{lost}</b>
            </span>
          </div>
          <div className="season-won">
            <div>
              <span className="board-label">Season won</span>
              <Num value={season.total} prefix="$" />
            </div>
            <div>
              <span className="board-label">Each</span>
              <Num value={season.perPerson} prefix="$" className={season.hits ? "each-good" : ""} />
              <span className="small muted">{season.hits} hit{season.hits === 1 ? "" : "s"}</span>
            </div>
          </div>
          <RecordGrid weeks={weeks} isAdmin={me.isAdmin} />
          {me.isAdmin && <p className="fine">Tap a week to set its result, odds or payout.</p>}
        </section>

        {/* 2. Players */}
        <section className="card">
          <div className="card-head">
            <h2 className="h-section">Players</h2>
            <span className="fine">{inPool} of {all.length} in</span>
          </div>
          <div className="pool">
            {[...all]
              .sort((a, b) => Number(b.inPool) - Number(a.inPool) || a.teamName.localeCompare(b.teamName))
              .map((m) => (
                <div className={`pool-row ${m.inPool ? "" : "out"}`} key={m.userId}>
                  <Avatar src={avatarUrl(m.avatar)} name={m.teamName} size={32} />
                  <span className="pool-name">
                    {m.teamName}
                    <small>
                      {m.username}
                      {handles.get(m.userId) ? ` · @${handles.get(m.userId)}` : ""}
                    </small>
                    {(m.userId === me.userId || me.isAdmin) && (
                      <details className="venmo-edit">
                        <summary>{handles.get(m.userId) ? "Edit Venmo" : "Add Venmo"}</summary>
                        <ActionForm action={setVenmo} className="row">
                          <input type="hidden" name="userId" value={m.userId} />
                          <input name="venmo" defaultValue={handles.get(m.userId) ?? ""} placeholder="venmo-name" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={`Venmo for ${m.teamName}`} />
                          <Submit className="btn btn-ghost">Save</Submit>
                        </ActionForm>
                      </details>
                    )}
                  </span>
                  {me.isAdmin ? (
                    <form action={setPoolMember}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <input type="hidden" name="active" value={m.inPool ? "false" : "true"} />
                      <button type="submit" className={`pill ${m.inPool ? "pill-green" : "pill-grey"} pill-btn`}>
                        {m.inPool ? "In" : "Out"}
                      </button>
                    </form>
                  ) : (
                    <span className={`pill ${m.inPool ? "pill-green" : "pill-grey"}`}>{m.inPool ? "In" : "Out"}</span>
                  )}
                </div>
              ))}
          </div>
          <p className="fine">
            Only teams marked In pick legs and can finish last.{" "}
            {me.isAdmin ? "Tap a pill to add or remove someone. It applies from the next loser pull." : `${admin?.teamName ?? "The admin"} manages this list.`}
          </p>
        </section>

        {/* 3. Payment history */}
        <section className="card">
          <h2 className="h-section">Payment history</h2>
          {losers.length === 0 ? (
            <p className="fine">No losers yet. They&apos;re pulled from Sleeper every Tuesday morning.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Wk</th><th>Last place</th><th className="num-col">Pts</th><th>Pays</th><th></th><th></th></tr>
                </thead>
                <tbody>
                  {losers.map((l) => {
                    // Week W's loser pays whoever placed Week W+1.
                    const bookieId = byWeek.get(l.week + 1)?.placed_by ?? null;
                    const square = bookieId === l.user_id;
                    return (
                    <tr key={`${l.week}-${l.user_id}`}>
                      <td>{l.week}</td>
                      <td>{byId.get(l.user_id)?.teamName ?? l.user_id}</td>
                      <td className="num-col">{Number(l.points).toFixed(2)}</td>
                      <td className="small">{square ? "Placed it" : bookieId ? byId.get(bookieId)?.teamName ?? "?" : <span className="muted">Not placed</span>}</td>
                      <td><PayChip state={l.confirmed ? "paid" : l.paid ? "says-paid" : "owes"} amount={config.loserAmount} /></td>
                      <td>
                        {(me.isAdmin || (bookieId === me.userId && !square)) && (
                          <form action={confirmPayment}>
                            <input type="hidden" name="week" value={l.week} />
                            <input type="hidden" name="userId" value={l.user_id} />
                            <input type="hidden" name="confirmed" value={l.confirmed ? "false" : "true"} />
                            <button className="btn-link" type="submit">{l.confirmed ? "Undo" : "Got it"}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="fine">
            Each week&apos;s loser pays whoever placed the next week&apos;s parlay. That bookie taps Got it when the ${config.loserAmount} lands{me.isAdmin ? " (you can too)" : ""}.
          </p>
          <details>
            <summary className="small muted">Stat correction or pool change? Re-pull a week</summary>
            <ActionForm action={recomputeLoser} className="row">
              <div className="field narrow">
                <label htmlFor="week">Week</label>
                <input id="week" name="week" inputMode="numeric" defaultValue={now.lastCompleted || 1} />
              </div>
              <Submit className="btn btn-ghost">Pull loser from Sleeper</Submit>
            </ActionForm>
            <p className="fine">
              Re-checks that one week against Sleeper&apos;s current scores and today&apos;s player list, and replaces its loser.
              Other weeks aren&apos;t touched. Anyone who already paid for that week stays on the books.
            </p>
          </details>
        </section>
      </main>
      <BottomNav current="league" />
    </>
  );
}
