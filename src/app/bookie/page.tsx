import { StatusChip, PayChip } from "@/components/chrome";
import { BottomNav } from "@/components/nav";
import { AppBar, Avatar } from "@/components/ui";
import { ActionForm, CopyButton, Submit } from "@/components/client";
import { placeBet, nudge, pingChat, confirmPayment } from "@/app/actions";
import { venmos } from "@/lib/venmos";
import { canEditLeg, cutoffFor, isEarly } from "@/lib/legrules";
import { sweepEarlyLegs } from "@/lib/sweep";
import { LegDeck, type DeckLeg } from "@/components/LegDeck";

const shortGame = (game: string) => game.split(" @ ").map((t) => t.trim().split(" ").slice(-1)[0]).join(" @ ");
import { requireMember } from "@/lib/session";
import { seasonNow } from "@/lib/season";
import { getLosers, getParlay } from "@/lib/db";
import { expectedPickers, slipText } from "@/lib/jobs";
import { config } from "@/lib/config";
import { formatAmerican } from "@/lib/math";
import { formatPt } from "@/lib/weeks";
import { dkParlayLink, oddsStatus, slotCode } from "@/lib/odds";
import { avatarUrl } from "@/lib/sleeper";
import { pushEnabled, subscribedUserIds } from "@/lib/push";

export const dynamic = "force-dynamic";

// This week only: who placed it, the slip to place, every slot as a card
// (empty ones to fill in texted-in picks), Nudge.
// Season stuff (record, players, payments) lives on the League tab.

export default async function BookiePage() {
  const { me, all } = await requireMember();
  await sweepEarlyLegs().catch(() => null);
  const now = await seasonNow();
  const [slip, parlay, pickers, feed, notifyOn, handles, allLosers] = await Promise.all([
    slipText(now.season, now.week),
    getParlay(now.season, now.week),
    expectedPickers(now.season, now.week, all),
    oddsStatus().catch(() => null),
    pushEnabled() ? subscribedUserIds().catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    venmos(all.find((m) => m.isAdmin)?.userId).catch(() => new Map<string, string>()),
    getLosers(now.season).catch(() => []),
  ]);
  const byId = new Map(all.map((m) => [m.userId, m]));
  const picked = new Set(slip.legs.map((l) => l.user_id));
  const missing = pickers.filter((p) => !picked.has(p.userId));
  const status = parlay?.status ?? "open";
  const placed = status !== "open";
  const placer = parlay?.placed_by ? byId.get(parlay.placed_by) ?? null : null;
  // Last week's loser(s) fund this week's parlay, so they pay whoever placed it.
  const owed = allLosers.filter((l) => l.week === now.week - 1);
  const placerVenmo = placer ? handles.get(placer.userId) ?? null : null;
  const canConfirm = !!placer && (placer.userId === me.userId || me.isAdmin);
  const myVenmo = handles.get(me.userId) ?? "";

  // The one-tap parlay: every leg that has a DraftKings outcome id.
  const legs = [...slip.legs].sort((a, b) => (a.commence_time ?? "9").localeCompare(b.commence_time ?? "9"));
  const inLink = legs.filter((l) => !!l.dk_link);
  const byHand = legs.filter((l) => !l.dk_link);
  const parlayLink = dkParlayLink(inLink.map((l) => l.dk_link));
  const finalized = now.locked || (pickers.length > 0 && missing.length === 0);
  const canNudge = !placed && missing.length > 0;
  // Legs on games before the Saturday lock (Thursday night) drop at their
  // game's cutoff unless the parlay is placed by then.
  const early = placed ? [] : legs.filter((l) => isEarly(l.commence_time, now.lock));
  const firstCutoff = early.length
    ? early.map((l) => cutoffFor(l.commence_time!)).sort((a, b) => a.getTime() - b.getTime())[0]
    : null;

  // One card per leg. If you can touch a leg you get both swipes (right to
  // change, left to remove): your own leg until the lock, any leg someone
  // entered for a player until it's placed, and every leg for the admin.
  const ctx = { viewerId: me.userId, isAdmin: me.isAdmin, locked: now.locked, placed };
  const deck: DeckLeg[] = legs.map((l) => {
    const owner = byId.get(l.user_id);
    const editable = canEditLeg({ userId: l.user_id, enteredBy: l.entered_by }, ctx);
    const kickoff = l.commence_time ? formatPt(new Date(l.commence_time), { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
    return {
      userId: l.user_id,
      teamName: owner?.teamName ?? "Someone",
      avatar: owner ? avatarUrl(owner.avatar) : null,
      slot: slotCode(l.market),
      selection: l.selection,
      where: [l.market === "custom" ? l.game : shortGame(l.game), kickoff].filter(Boolean).join(" · "),
      price: formatAmerican(l.price),
      inLink: !!l.dk_link,
      enteredBy: l.entered_by ? byId.get(l.entered_by)?.teamName ?? "someone" : null,
      isMine: l.user_id === me.userId,
      swipeable: editable,
      changeHref: editable ? (l.user_id === me.userId ? "/search" : `/search?for=${l.user_id}`) : null,
      empty: false,
      notifyOff: false,
    };
  });
  // Empty slots last, yours first. Anyone can add a pick for someone else until
  // it's placed (texted-in picks); your own slot follows the lock.
  const empties: DeckLeg[] = [...missing]
    .sort((a, b) => Number(b.userId === me.userId) - Number(a.userId === me.userId) || a.teamName.localeCompare(b.teamName))
    .map((m) => {
      const mine = m.userId === me.userId;
      const canAdd = !placed && (mine ? !now.locked || me.isAdmin : true);
      return {
        userId: m.userId,
        teamName: m.teamName,
        avatar: avatarUrl(m.avatar),
        slot: "—",
        selection: "",
        where: "",
        price: "",
        inLink: false,
        enteredBy: null,
        isMine: mine,
        swipeable: false,
        changeHref: canAdd ? (mine ? "/search" : `/search?for=${m.userId}`) : null,
        empty: true,
        notifyOff: pushEnabled() && !notifyOn.has(m.userId),
      };
    });
  deck.push(...empties);

  return (
    <>
      <AppBar />
      <main className="wrap">
        <div className="pill-row">
          <span className="beige-pill">Bookie</span>
          <span className="beige-pill">Week {now.week}</span>
        </div>
        <div className="hero-row">
          <StatusChip status={placed ? status : now.locked ? "locked" : "open"} />
          <span className="fine">
            {now.locked ? `Locked ${formatPt(now.lock)}` : `Locks ${formatPt(now.lock)} PT`} · {slip.legs.length}/{pickers.length} legs
          </span>
        </div>

        {/* Who placed it now shows on The Slip, in the loser card ("Week 3 bookie"). */}

        {/* Who owes the bookie, with Got it for the bookie (or admin) */}
        {placer && owed.length > 0 && (
          <section className="card">
            <h2 className="h-section">Owed to {placer.userId === me.userId ? "you" : placer.teamName}</h2>
            <div className="bottom">
              {owed.map((l) => {
                const who = byId.get(l.user_id);
                const state = l.confirmed ? "paid" : l.paid ? "says-paid" : "owes";
                return (
                  <div className="bottom-row" key={l.user_id}>
                    <span>
                      {who?.teamName ?? "?"}
                      {l.user_id === placer.userId && <span className="fine"> · placed it, so square</span>}
                    </span>
                    <span className="row" style={{ gap: 10 }}>
                      <PayChip state={state} amount={config.loserAmount} />
                      {canConfirm && l.user_id !== placer.userId && (
                        <form action={confirmPayment}>
                          <input type="hidden" name="week" value={l.week} />
                          <input type="hidden" name="userId" value={l.user_id} />
                          <input type="hidden" name="confirmed" value={l.confirmed ? "false" : "true"} />
                          <button className="btn-link" type="submit">{l.confirmed ? "Undo" : "Got it"}</button>
                        </form>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {canConfirm && <p className="fine">Tap Got it when the ${config.loserAmount} lands in your Venmo.</p>}
          </section>
        )}

        {/* 2. Slip to place (with "I placed it") */}
        <section className="card">
          <div className="card-head">
            <h2 className="h-section">Slip to place</h2>
            <CopyButton text={slip.text} />
          </div>

          {parlayLink && finalized && !placed ? (
            <a className="btn btn-green btn-block" href={parlayLink} target="_blank" rel="noopener noreferrer">
              Open parlay in DraftKings · {inLink.length} leg{inLink.length === 1 ? "" : "s"}
            </a>
          ) : (
            <button type="button" className="btn btn-ghost btn-block" disabled>
              {placed
                ? `Placed by ${placer?.teamName ?? "someone"}${parlay?.dk_odds ? ` at ${formatAmerican(parlay.dk_odds)}` : ""}`
                : !finalized
                  ? `Opens when all ${pickers.length} legs are in or picks lock (${missing.length} to go)`
                  : "No legs with a DraftKings link"}
            </button>
          )}

          {legs.length === 0 && <p className="fine">No legs yet.</p>}
          {firstCutoff && (
            <p className="notice">
              {early.length} leg{early.length === 1 ? " is" : "s are"} on an early game ({early.map((l) => byId.get(l.user_id)?.teamName ?? "someone").join(", ")}).
              Place it and tap I placed it by <b>{formatPt(firstCutoff)} PT</b>, 15 minutes before kickoff, or {early.length === 1 ? "that leg comes" : "those legs come"} off the slip.
            </p>
          )}
          <p className="fine">
            Est. {formatAmerican(slip.combo.american)} · ${slip.stake} stake.{" "}
            {byHand.length > 0
              ? `${byHand.length} leg${byHand.length === 1 ? "" : "s"} (player props or typed-in bets) can't go in the link: after it opens, search ${byHand.length === 1 ? "it" : "them"} in DraftKings and add to the same betslip. `
              : ""}
            Check the betslip shows {legs.length} legs before placing.
          </p>

          {!placed && legs.length > 0 && (
            <details className="place-form">
              <summary>
                <span className="btn btn-ghost btn-block">I placed it</span>
              </summary>
              <ActionForm action={placeBet} className="stack">
                <div className="row">
                  <div className="field">
                    <label htmlFor="dk_odds">Final odds</label>
                    <input id="dk_odds" name="dk_odds" inputMode="numeric" placeholder={formatAmerican(slip.combo.american)} />
                  </div>
                  <div className="field">
                    <label htmlFor="stake">Stake ($)</label>
                    <input id="stake" name="stake" inputMode="decimal" defaultValue={slip.stake} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="venmo">Your Venmo (last week&apos;s loser pays you back)</label>
                  <input id="venmo" name="venmo" defaultValue={myVenmo} placeholder="your-venmo-name" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
                </div>
                <div className="field">
                  <label htmlFor="note">Note for the league (optional)</label>
                  <input id="note" name="note" maxLength={200} placeholder="Swapped Chase TD for Chase 60+ yds, TD wasn't offered" />
                </div>
                <Submit className="btn btn-green">Confirm: I placed it</Submit>
                <p className="fine">Only after DraftKings confirms the bet. You&apos;ll show up as this week&apos;s bookie.</p>
              </ActionForm>
            </details>
          )}

          {now.locked && !placed && (
            <ActionForm action={pingChat} className="row">
              <Submit className="btn-link">Post the final slip to the group chat</Submit>
            </ActionForm>
          )}

        </section>

        {deck.length > 0 && (
          <>
            <h2 className="section-label">Legs · {legs.length}/{pickers.length}</h2>
            <LegDeck legs={deck} isAdmin={me.isAdmin} />
          </>
        )}

        {/* 3. Who hasn't picked, with texted-in picks */}
        {/* 3. Nudge */}
        <ActionForm action={nudge} className="nudge-wrap">
          <Submit className="btn btn-nudge" disabled={!canNudge}>Nudge</Submit>
          <p className="fine center">
            {placed
              ? "The bet is in."
              : missing.length
                ? `Sends a notification to the ${missing.length} ${missing.length === 1 ? "person" : "people"} without a leg. Once every 30 minutes.`
                : "Everyone's in."}
          </p>
        </ActionForm>

        <p className="fine center">Game lines: ESPN (DraftKings lines, free). {feed?.text}</p>
      </main>
      <BottomNav current="bookie" />
    </>
  );
}
