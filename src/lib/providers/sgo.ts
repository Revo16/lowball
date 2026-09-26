import "server-only";
import type { OddsEvent } from "../lines";
import { mapSgoEvent, type SgoEvent } from "./sgo-map";
export { mapSgoEvent, propKey } from "./sgo-map";

// SportsGameOdds. Free "Amateur" plan: 2,500 objects a month, where one game
// is one object no matter how many markets come back. One call returns every
// DraftKings prop for every game in the window.
// Docs: https://sportsgameodds.com/docs  oddID = statID-statEntityID-periodID-betTypeID-sideID

const BASE = "https://api.sportsgameodds.com/v2/events";

/** Every NFL game in the window with DraftKings odds. Returns objects used for budgeting. */
export async function sgoSlate(apiKey: string, from: Date, to: Date) {
  const events: OddsEvent[] = [];
  let objects = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL(BASE);
    url.searchParams.set("leagueID", "NFL");
    url.searchParams.set("bookmakerID", "draftkings");
    url.searchParams.set("oddsAvailable", "true");
    url.searchParams.set("startsAfter", from.toISOString());
    url.searchParams.set("startsBefore", to.toISOString());
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { cache: "no-store", headers: { "X-Api-Key": apiKey } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SportsGameOdds returned ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
    }
    const body = (await res.json()) as { success?: boolean; data?: SgoEvent[]; nextCursor?: string; error?: string };
    if (body.success === false) throw new Error(`SportsGameOdds: ${body.error ?? "request failed"}`);
    const data = body.data ?? [];
    objects += data.length;
    for (const ev of data) {
      const mapped = mapSgoEvent(ev);
      if (mapped) events.push(mapped);
    }
    if (!body.nextCursor || !data.length) break;
    cursor = body.nextCursor;
  }
  return { events, objects };
}
