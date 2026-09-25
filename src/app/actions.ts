"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { db, getLegs, getParlay, claimMessage, type Leg } from "@/lib/db";
import { pushEnabled, pushTo } from "@/lib/push";
import { formatPt } from "@/lib/weeks";
import { setInPool } from "@/lib/pool";
import { seasonNow } from "@/lib/season";
import { members, type Member } from "@/lib/sleeper";
import { setSession, clearSession, pinMatches, requireMember, requireAdmin } from "@/lib/session";
import { gameOdds, eventProps, dkMarkets, selectionLabel, gameLabel, lineKey, conflictFor, MARKET_LABEL } from "@/lib/odds";
import { recordLosers, expectedPickers, lockMessage } from "@/lib/jobs";
import { notify } from "@/lib/notify";
import { canEditLeg, editBlockedReason } from "@/lib/legrules";

export type FormState = { error?: string; ok?: string };

function str(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/search");
  revalidatePath("/bookie");
  revalidatePath("/league");
}

/* ---------- sign in ---------- */

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const userId = str(form, "userId");
  if (!pinMatches(str(form, "pin"))) return { error: "That passcode doesn't match. Check the group chat for it." };
  const all = await members();
  if (!all.some((m) => m.userId === userId)) return { error: "Pick your team from the list." };
  await setSession(userId);
  redirect("/");
}

export async function signOut() {
  await clearSession();
  redirect("/login");
}

/* ---------- picking ---------- */

export type PickResult = { error?: string; ok?: string; key?: string; undo?: string };

type Target = { me: Member; userId: string; teamName: string };

/**
 * Who can put a leg on the slip (see canEditLeg in lib/legrules for changes):
 *  - you, for yourself, until the lock;
 *  - anyone, for a pool member with no leg yet (texted-in picks), until it's placed;
 *  - anyone, replacing a leg someone else entered for that person, until it's placed;
 *  - nobody but the owner (and the admin) can touch a leg the owner picked himself.
 */
async function assertCanPick(t: Target) {
  const now = await seasonNow();
  const parlay = await getParlay(now.season, now.week);
  const placed = !!parlay && parlay.status !== "open";
  if (placed) throw new Error("This week's parlay is already placed.");
  const pickers = await expectedPickers(now.season, now.week);
  const forSelf = t.userId === t.me.userId;
  if (!t.me.isAdmin && !pickers.some((p) => p.userId === t.userId)) {
    throw new Error(forSelf ? "You're not in the pool this season." : `${t.teamName} isn't in the pool this season.`);
  }
  const existing = (await getLegs(now.season, now.week)).find((l) => l.user_id === t.userId);
  if (existing) {
    const owner = { userId: existing.user_id, enteredBy: existing.entered_by };
    const ctx = { viewerId: t.me.userId, isAdmin: t.me.isAdmin, locked: now.locked, placed };
    if (!canEditLeg(owner, ctx)) throw new Error(editBlockedReason(owner, ctx, t.teamName));
  } else if (forSelf && now.locked && !t.me.isAdmin) {
    throw new Error("Picks are locked for this week.");
  }
  return now;
}

type NewLeg = {
  event_id: string | null;
  commence_time: string | null;
  game: string;
  market: string;
  selection: string;
  outcome_name: string | null;
  outcome_desc: string | null;
  point: number | null;
  price: number | null;
  dk_link?: string | null;
};

async function saveLeg(t: Target, leg: NewLeg) {
  const now = await assertCanPick(t);
  if (leg.commence_time && new Date(leg.commence_time) <= now.lock) {
    throw new Error("That game kicks off before picks lock, so it can't go on the parlay.");
  }
  const legs = await getLegs(now.season, now.week);
  const clash = conflictFor(
    { eventId: leg.event_id, market: leg.market, desc: leg.outcome_desc },
    legs
      .filter((l) => l.user_id !== t.userId)
      .map((l) => ({ userId: l.user_id, eventId: l.event_id, market: l.market, desc: l.outcome_desc })),
  );
  if (clash) {
    const who = (await members()).find((m) => m.userId === clash.userId)?.teamName ?? "Someone";
    const taken = legs.find((l) => l.user_id === clash.userId)?.selection ?? "that line";
    throw new Error(
      leg.market.startsWith("player_")
        ? `${who} already has ${taken}. Pick a different player or stat.`
        : `${who} already has ${taken} in this game. DraftKings won't take two ${(MARKET_LABEL[leg.market] ?? "").toLowerCase()} bets from one game.`,
    );
  }
  const res = await db().from("legs").upsert(
    {
      season: now.season,
      week: now.week,
      user_id: t.userId,
      ...leg,
      entered_by: t.userId !== t.me.userId ? t.me.userId : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "season,week,user_id" },
  );
  if (res.error) throw new Error(`Couldn't save the pick: ${res.error.message}`);
  refresh();
}

/** Push to the leg's owner when someone else entered it. Never blocks the pick. */
async function tellOwner(t: Target, selection: string): Promise<string> {
  if (t.userId === t.me.userId) return "";
  const now = await seasonNow();
  const r = await pushTo([t.userId], {
    title: `${t.me.teamName} entered your Week ${now.week} leg`,
    body: `${selection}. Not right? Change or remove it in the app. Pick it yourself and nobody else can touch it.`,
    url: "/",
    tag: `entered-${now.week}`,
  }).catch(() => null);
  return r?.reached.length ? " They got a notification." : " (Their notifications are off, so let them know.)";
}

async function resolveTarget(forUser?: string | null): Promise<Target> {
  const { me, all } = await requireMember();
  if (forUser && forUser !== me.userId) {
    const m = all.find((x) => x.userId === forUser);
    if (!m) throw new Error("That team isn't in the league.");
    return { me, userId: m.userId, teamName: m.teamName };
  }
  return { me, userId: me.userId, teamName: me.teamName };
}

function priceText(p: number) {
  return p > 0 ? `+${p}` : `${p}`;
}

/** Tapping a line on Find a bet. The price is always re-read from the odds cache. */
export async function pickBoardLine(input: {
  eventId: string;
  market: string;
  name: string;
  desc: string;
  point: number | null;
  forUser?: string | null;
}): Promise<PickResult> {
  try {
    const target = await resolveTarget(input.forUser);
    const now = await seasonNow();
    let event = null;
    if (input.market.startsWith("player_")) {
      event = (await eventProps(now, input.eventId))?.event ?? null;
    } else {
      event = (await gameOdds(now)).events.find((e) => e.id === input.eventId) ?? null;
    }
    if (!event) return { error: "That game isn't on the board anymore." };
    const outcome = dkMarkets(event)
      .find((m) => m.key === input.market)
      ?.outcomes.find(
        (o) =>
          o.name === input.name &&
          (o.description ?? "") === (input.desc ?? "") &&
          (o.point ?? null) === (input.point ?? null),
      );
    if (!outcome) return { error: "That line just moved or came off the board. Search again for the current number." };

    const selection = selectionLabel(input.market, outcome);
    await saveLeg(target, {
      event_id: event.id,
      commence_time: event.commence_time,
      game: gameLabel(event),
      market: input.market,
      selection,
      outcome_name: outcome.name,
      outcome_desc: outcome.description ?? null,
      point: outcome.point ?? null,
      price: outcome.price,
      dk_link: outcome.link ?? null,
    });
    const told = await tellOwner(target, `${selection} (${priceText(outcome.price)})`);
    return {
      ok: target.userId === target.me.userId
        ? `${selection} (${priceText(outcome.price)}) is on the slip`
        : `${selection} is on ${target.teamName}'s slip.${told}`,
      key: lineKey(event.id, input.market, outcome.name, outcome.description ?? "", outcome.point ?? null),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function pickCustom(_: FormState, form: FormData): Promise<FormState> {
  try {
    const target = await resolveTarget(str(form, "forUser"));
    const selection = str(form, "selection").slice(0, 120);
    const game = str(form, "game").slice(0, 80);
    const priceRaw = str(form, "price").replace(/\s/g, "");
    if (selection.length < 3) return { error: "Describe the bet, e.g. \"Jaxon Smith-Njigba 80+ receiving yards\"." };
    if (!game) return { error: "Add the game, e.g. \"Seahawks vs Cardinals\"." };
    let price: number | null = null;
    if (priceRaw) {
      price = Number(priceRaw);
      if (!Number.isInteger(price) || Math.abs(price) < 100 || Math.abs(price) > 100000) {
        return { error: "Odds should look like -115 or +240, the way DraftKings shows them." };
      }
    }
    await saveLeg(target, {
      event_id: null,
      commence_time: null,
      game,
      market: "custom",
      selection,
      outcome_name: null,
      outcome_desc: null,
      point: null,
      price,
    });
    const told = await tellOwner(target, selection);
    return { ok: target.userId === target.me.userId ? `${selection} is on the slip` : `${selection} is on ${target.teamName}'s slip.${told}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function removeLeg(forUser?: string | null): Promise<PickResult> {
  try {
    const { me } = await requireMember();
    const now = await seasonNow();
    const parlay = await getParlay(now.season, now.week);
    const userId = forUser || me.userId;
    const existing = (await getLegs(now.season, now.week)).find((l) => l.user_id === userId);
    if (!existing) return { error: "There's no leg to remove." };
    const all = await members();
    const teamName = all.find((m) => m.userId === userId)?.teamName ?? "That player";
    const owner = { userId, enteredBy: existing.entered_by };
    const ctx = { viewerId: me.userId, isAdmin: me.isAdmin, locked: now.locked, placed: !!parlay && parlay.status !== "open" };
    if (!canEditLeg(owner, ctx)) return { error: editBlockedReason(owner, ctx, teamName) };
    await db().from("legs").delete().match({ season: now.season, week: now.week, user_id: userId });
    refresh();
    const undo = undoToken(existing);
    if (userId === me.userId) return { ok: "Removed from the slip", undo };
    let told = "";
    try {
      const r = await pushTo([userId], {
        title: `${me.teamName} removed your Week ${now.week} leg`,
        body: `${existing.selection} is off the slip. Pick a new one in the app.`,
        url: "/search",
        tag: `leg-${now.week}`,
      });
      told = r.reached.length ? " They got a notification." : pushEnabled() ? " (Their notifications are off, so let them know.)" : "";
    } catch {}
    return { ok: `Removed ${teamName}'s leg.${told}`, undo };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/* ---------- undo a remove ---------- */

// Removing hands back a signed copy of the deleted row, so Undo can put
// exactly that leg back without trusting anything else from the phone.
function undoToken(leg: Leg) {
  const body = Buffer.from(JSON.stringify({ leg, at: Date.now() })).toString("base64url");
  return `${body}.${createHmac("sha256", config.sessionSecret).update(`undo:${body}`).digest("base64url")}`;
}

export async function restoreLeg(token: string): Promise<PickResult> {
  try {
    const { me } = await requireMember();
    const [body, sig] = String(token).split(".");
    const expected = createHmac("sha256", config.sessionSecret).update(`undo:${body}`).digest("base64url");
    if (!body || !sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { error: "Couldn't undo that." };
    }
    const { leg, at } = JSON.parse(Buffer.from(body, "base64url").toString()) as { leg: Leg; at: number };
    if (Date.now() - at > 10 * 60_000) return { error: "Too late to undo. Enter the leg again instead." };
    const now = await seasonNow();
    if (leg.season !== now.season || leg.week !== now.week) return { error: "That week has moved on." };
    const parlay = await getParlay(now.season, now.week);
    if (parlay && parlay.status !== "open") return { error: "This week's parlay is already placed." };
    const legs = await getLegs(now.season, now.week);
    if (legs.some((l) => l.user_id === leg.user_id)) return { error: "That slot already has a new leg." };
    const clash = conflictFor(
      { eventId: leg.event_id, market: leg.market, desc: leg.outcome_desc },
      legs.map((l) => ({ userId: l.user_id, eventId: l.event_id, market: l.market, desc: l.outcome_desc })),
    );
    if (clash) return { error: "Someone took a clashing line in that game since, so it can't go back." };
    const { id: _id, ...row } = leg as Leg & Record<string, unknown>;
    const res = await db().from("legs").insert(row);
    if (res.error) return { error: `Couldn't put it back: ${res.error.message}` };
    refresh();
    if (leg.user_id !== me.userId) {
      // Same tag as the "removed" push, so it replaces that notification.
      await pushTo([leg.user_id], {
        title: `Your Week ${now.week} leg is back`,
        body: `${me.teamName} undid removing ${leg.selection}.`,
        url: "/",
        tag: `leg-${now.week}`,
      }).catch(() => null);
    }
    return { ok: "Put back on the slip" };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/* ---------- paying ---------- */

export async function iPaid(week: number) {
  const { me } = await requireMember();
  const now = await seasonNow();
  // The admin holds the money, so their own "payment" is confirmed on the spot.
  await db()
    .from("losers")
    .update({ paid: true, paid_at: new Date().toISOString(), ...(me.isAdmin ? { confirmed: true } : {}) })
    .match({ season: now.season, week, user_id: me.userId });
  refresh();
}

/** Every $5 goes to the admin's Venmo, so only the admin marks it received. */
export async function confirmPayment(form: FormData) {
  const { me } = await requireMember();
  if (!me.isAdmin) return;
  const now = await seasonNow();
  const week = Number(str(form, "week"));
  const userId = str(form, "userId");
  const confirmed = str(form, "confirmed") === "true";
  const patch: Record<string, unknown> = { confirmed };
  if (confirmed) {
    patch.paid = true;
    patch.paid_at = new Date().toISOString();
  }
  await db().from("losers").update(patch).match({ season: now.season, week, user_id: userId });
  refresh();
}

/* ---------- pool ---------- */

export async function setPoolMember(form: FormData) {
  const { me } = await requireAdmin();
  const userId = str(form, "userId");
  const active = str(form, "active") === "true";
  if (!userId) return;
  await setInPool(userId, active);
  refresh();
  void me;
}

/* ---------- placing ---------- */

export async function recomputeLoser(_: FormState, form: FormData): Promise<FormState> {
  try {
    await requireMember();
    const now = await seasonNow();
    const week = Number(str(form, "week"));
    if (!Number.isInteger(week) || week < 1 || week > now.lastCompleted) {
      return { error: `Pick a finished week (1 to ${now.lastCompleted}).` };
    }
    const result = await recordLosers(now.season, week);
    refresh();
    if (!result) return { error: `Sleeper has no scores for week ${week} yet.` };
    return { ok: `Week ${week}: ${result.members.map((m) => m.teamName).join(" & ")} (${result.points.toFixed(2)})` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** "I placed it": anyone can record it once. That person is the week's bookie. */
export async function placeBet(_: FormState, form: FormData): Promise<FormState> {
  try {
    const { me } = await requireMember();
    const now = await seasonNow();
    const existing = await getParlay(now.season, now.week);
    if (existing && existing.status !== "open") {
      const who = existing.placed_by ? (await members()).find((m) => m.userId === existing.placed_by)?.teamName : null;
      return { error: `Already placed${who ? ` by ${who}` : ""}.` };
    }
    const odds = parseOdds(str(form, "dk_odds"));
    if (odds === undefined) return { error: "Final odds should look like +2450, the way DraftKings shows them." };
    const stake = parseMoney(str(form, "stake"));
    const res = await db().from("parlays").upsert(
      {
        season: now.season,
        week: now.week,
        status: "placed",
        dk_odds: odds,
        stake,
        note: str(form, "note").slice(0, 200) || null,
        placed_by: me.userId,
        placed_at: new Date().toISOString(),
      },
      { onConflict: "season,week" },
    );
    if (res.error) return { error: res.error.message };
    refresh();
    await notify(`${me.teamName} placed the Week ${now.week} parlay${odds ? ` at ${odds > 0 ? "+" : ""}${odds}` : ""}.`).catch(() => null);
    return { ok: "Recorded. The Slip shows it's placed." };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Admin: set any week's result, odds and payout. "Not placed" clears who placed it. */
export async function saveRecord(_: FormState, form: FormData): Promise<FormState> {
  try {
    await requireAdmin();
    const now = await seasonNow();
    const week = Number(str(form, "week"));
    if (!Number.isInteger(week) || week < 1 || week > 22) return { error: "Unknown week." };
    const status = str(form, "status");
    if (!["open", "placed", "won", "lost", "void"].includes(status)) return { error: "Unknown result." };
    const odds = parseOdds(str(form, "dk_odds"));
    if (odds === undefined) return { error: "Odds should look like +2450." };
    const existing = await getParlay(now.season, week);
    const res = await db().from("parlays").upsert(
      {
        season: now.season,
        week,
        status,
        dk_odds: odds,
        stake: parseMoney(str(form, "stake")),
        payout: parseMoney(str(form, "payout")),
        placed_by: status === "open" ? null : existing?.placed_by ?? null,
        placed_at: status === "open" ? null : existing?.placed_at ?? new Date().toISOString(),
        settled_at: ["won", "lost", "void"].includes(status) ? existing?.settled_at ?? new Date().toISOString() : null,
      },
      { onConflict: "season,week" },
    );
    if (res.error) return { error: res.error.message };
    refresh();
    return { ok: `Week ${week} saved.` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function parseOdds(raw: string): number | null | undefined {
  const v = raw.replace(/\s/g, "");
  if (!v) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : undefined;
}

function parseMoney(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return raw && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Push a reminder to every pool member without a leg. Once per 30 minutes. */
export async function nudge(_: FormState, _form: FormData): Promise<FormState> {
  try {
    const { me, all } = await requireMember();
    if (!pushEnabled()) return { error: "Notifications aren't set up yet (VAPID keys missing). See the README." };
    const now = await seasonNow();
    const [legs, pickers] = await Promise.all([getLegs(now.season, now.week), expectedPickers(now.season, now.week, all)]);
    const have = new Set(legs.map((l) => l.user_id));
    const missing = pickers.filter((p) => !have.has(p.userId));
    if (!missing.length) return { error: "Everyone has picked." };
    const slot = Math.floor(Date.now() / (30 * 60_000));
    if (!(await claimMessage(`nudge:${now.season}:${now.week}:${slot}`))) {
      return { error: "Someone nudged in the last 30 minutes. Give them a minute." };
    }
    const { reached, off } = await pushTo(
      missing.map((m) => m.userId),
      {
        title: `Week ${now.week}: you haven't picked`,
        body: `${me.teamName} nudged you. ${now.locked ? "Picks are locked, but the bookie can still add you." : `Picks lock ${formatPt(now.lock)}.`}`,
        url: "/search",
        tag: `nudge-${now.week}`,
      },
    );
    const name = (id: string) => all.find((m) => m.userId === id)?.teamName ?? "?";
    const parts = [`Pinged ${reached.length} of ${missing.length}.`];
    if (off.length) parts.push(`Notifications off: ${off.map(name).join(", ")}.`);
    return reached.length ? { ok: parts.join(" ") } : { error: parts.join(" ") };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Posts the final slip to the group chat after the lock. */
export async function pingChat(_: FormState, _form: FormData): Promise<FormState> {
  try {
    await requireMember();
    const text = await lockMessage();
    if (!text) return { error: "The slip posts after picks lock." };
    const { sent } = await notify(text);
    if (!sent.length) return { error: "No group chat is connected. Add DISCORD_WEBHOOK_URL or GROUPME_BOT_ID." };
    return { ok: `Posted to ${sent.join(" and ")}.` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
