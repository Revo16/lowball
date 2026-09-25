import { PayChip } from "@/components/chrome";
import { BottomNav } from "@/components/nav";
import { AppBar, Avatar } from "@/components/ui";
import { ActionForm, Submit } from "@/components/client";
import { RecordGrid, type RecordWeek } from "@/components/RecordGrid";
import { confirmPayment, setPoolMember, recomputeLoser } from "@/app/actions";
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
  const [parlays, losers] = await Promise.all([getParlays(now.season), getLosers(now.season)]);
  const byId = new Map(all.map((m) => [m.userId, m]));
  const admin = all.find((m) => m.isAdmin);
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
                    <small>{m.username}</small>
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
                  <tr><th>Wk</th><th>Last place</th><th className="num-col">Pts</th><th></th><th></th></tr>
                </thead>
                <tbody>
                  {losers.map((l) => (
                    <tr key={`${l.week}-${l.user_id}`}>
                      <td>{l.week}</td>
                      <td>{byId.get(l.user_id)?.teamName ?? l.user_id}</td>
                      <td className="num-col">{Number(l.points).toFixed(2)}</td>
                      <td><PayChip state={l.confirmed ? "paid" : l.paid ? "says-paid" : "owes"} amount={config.loserAmount} /></td>
                      <td>
                        {me.isAdmin && (
                          <form action={confirmPayment}>
                            <input type="hidden" name="week" value={l.week} />
                            <input type="hidden" name="userId" value={l.user_id} />
                            <input type="hidden" name="confirmed" value={l.confirmed ? "false" : "true"} />
                            <button className="btn-link" type="submit">{l.confirmed ? "Undo" : "Got it"}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="fine">
            Everyone pays @{config.payToVenmo}{admin ? ` (${admin.teamName})` : ""}.
            {me.isAdmin ? " Tap Got it when the $5 lands." : ""}
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
            <p className="fine">Anyone who already paid stays on the books.</p>
          </details>
        </section>
      </main>
      <BottomNav current="league" />
    </>
  );
}
