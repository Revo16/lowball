// Local smoke-test harness: stubs Sleeper, The Odds API and Supabase's REST API
// so the app can run end to end without network. Not shipped.
// Usage: NODE_OPTIONS="--require ./scripts/mock.cjs" next start
const users = [
  ["565349860547133440", "IAmEeb", "Need for Shaheed", 1],
  ["1128911101363654656", "kobepop1", "Slippin' Tony", 2],
  ["1128918350354141184", "jpauly360", "The Paulocaust", 3],
  ["1065164963234271232", "BigBadBerto", "The Hogfather", 4],
  ["1091574155851526144", "NotoriousBJF", null, 5],
  ["1022369590301257728", "diegodorta", "The Dorture Chamber", 6],
  ["1022603316649414656", "varunneti", "4KTREY NUTTR", 7],
  ["1065010551270563840", "BeckT4", "The Bonkytonk", 8],
  ["993367322029056000", "Ctemps51", "Bluuuuuuurrrrr", 9],
  ["1065765604533145600", "smithz14", "tobiechip", 10],
  ["1067937915054952448", "cbiesold", "oy vey my ACL", 11],
  ["605898405117521920", "Revo16", "The Lone Wolf", 12],
];
const week2 = [140.82, 175.32, 121.04, 86.38, 103.98, 70.28, 94.4, 123.96, 75.7, 99.36, 150.86, 124.82];
const week3 = [12.4, 20.1, 8.8, 15, 30.2, 9.9, 0, 11, 14.3, 22, 5.6, 18];

// Five Week 3 games. After the first fetch, some prices drift so the live
// slip has something to show.
let gameCalls = 0;
const propCalls = {};
const G = (id, t, away, home, sp, ml, tot) => ({ id, t, away, home, sp, ml, tot });
const GAMES = [
  G("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "2026-09-27T20:05:00Z", "Seattle Seahawks", "Arizona Cardinals", [-2.5, -110, -110], [-142, 120], [44.5, -108, -112]),
  G("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "2026-09-27T20:25:00Z", "Buffalo Bills", "Kansas City Chiefs", [1.5, -115, -105], [105, -125], [51.5, -110, -110]),
  G("cccccccccccccccccccccccccccccccc", "2026-09-27T17:00:00Z", "Detroit Lions", "Green Bay Packers", [-3, -108, -112], [-155, 130], [48.5, -105, -115]),
  G("dddddddddddddddddddddddddddddddd", "2026-09-28T00:20:00Z", "Philadelphia Eagles", "Dallas Cowboys", [-4.5, -110, -110], [-205, 170], [46.5, -112, -108]),
  G("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "2026-09-29T00:15:00Z", "Cincinnati Bengals", "Baltimore Ravens", [3, -105, -115], [135, -160], [49.5, -110, -110]),
];
const PLAYERS = {
  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: [["Kenneth Walker III", "rush", 64.5, 105], ["Jaxon Smith-Njigba", "rec", 74.5, 140], ["Trey McBride", "rec", 58.5, 190], ["Kyler Murray", "pass", 231.5, 900]],
  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: [["Josh Allen", "pass", 248.5, 150], ["James Cook", "rush", 71.5, -105], ["Travis Kelce", "rec", 49.5, 175], ["Patrick Mahomes", "pass", 262.5, 400]],
  cccccccccccccccccccccccccccccccc: [["Jahmyr Gibbs", "rush", 78.5, -140], ["Amon-Ra St. Brown", "rec", 82.5, 110], ["Jordan Love", "pass", 244.5, 600], ["Josh Jacobs", "rush", 69.5, 115]],
  dddddddddddddddddddddddddddddddd: [["Saquon Barkley", "rush", 92.5, -130], ["A.J. Brown", "rec", 71.5, 130], ["CeeDee Lamb", "rec", 84.5, 105], ["Dak Prescott", "pass", 255.5, 800]],
  eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee: [["Ja'Marr Chase", "rec", 88.5, -105], ["Derrick Henry", "rush", 86.5, -165], ["Joe Burrow", "pass", 271.5, 700], ["Lamar Jackson", "rush", 54.5, 300]],
};

function gameEvent(g) {
  const drift = gameCalls > 1;
  const sp = drift && g.away === "Seattle Seahawks" ? [-3, -105, -115] : g.sp;
  const ml = drift && g.home === "Kansas City Chiefs" ? [115, -135] : g.ml;
  const tot = drift && g.away === "Seattle Seahawks" ? [44.5, -118, -102] : g.tot;
  return {
    id: g.id, commence_time: g.t, home_team: g.home, away_team: g.away,
    bookmakers: [{ key: "draftkings", last_update: new Date().toISOString(), markets: [
      { key: "h2h", outcomes: [{ name: g.away, price: ml[0] }, { name: g.home, price: ml[1] }] },
      { key: "spreads", outcomes: [{ name: g.away, price: sp[1], point: sp[0] }, { name: g.home, price: sp[2], point: -sp[0] }] },
      { key: "totals", outcomes: [{ name: "Over", price: tot[1], point: tot[0] }, { name: "Under", price: tot[2], point: tot[0] }] },
    ] }],
  };
}

function propsEvent(id, wanted) {
  const g = GAMES.find((x) => x.id === id);
  const drift = (propCalls[id] = (propCalls[id] ?? 0) + 1) > 1;
  const markets = {
    player_anytime_td: { key: "player_anytime_td", outcomes: [] },
    player_pass_yds: { key: "player_pass_yds", outcomes: [] },
    player_rush_yds: { key: "player_rush_yds", outcomes: [] },
    player_reception_yds: { key: "player_reception_yds", outcomes: [] },
  };
  for (const [name, kind, line, td] of PLAYERS[id] ?? []) {
    const mk = kind === "pass" ? "player_pass_yds" : kind === "rush" ? "player_rush_yds" : "player_reception_yds";
    const over = drift && name === "Jaxon Smith-Njigba" ? -125 : -115;
    markets[mk].outcomes.push({ name: "Over", description: name, price: over, point: line }, { name: "Under", description: name, price: -115, point: line });
    markets.player_anytime_td.outcomes.push({ name: "Yes", description: name, price: td });
  }
  return {
    id, commence_time: g.t, home_team: g.home, away_team: g.away,
    bookmakers: [{ key: "draftkings", last_update: "x", markets: wanted.map((w) => markets[w]).filter((m) => m && m.outcomes.length) }],
  };
}


// ---- ESPN scoreboard (shape copied from a real response) ----
let espnCalls = 0;
const dk = (outcome) => ({ href: `https://sportsbook.draftkings.com/gateway?s=__s__&wpcn=ESPN&preurl=${encodeURIComponent("https://sportsbook.draftkings.com/event/34118180?outcomes=" + outcome)}` });
const sgn = (n) => (n > 0 ? `+${n}` : `${n}`);
function espnEvent(g, i) {
  const drift = espnCalls > 1;
  const sp = drift && g.away === "Seattle Seahawks" ? [-3, -105, -115] : g.sp;
  const ml = drift && g.home === "Kansas City Chiefs" ? [115, -135] : g.ml;
  const tot = drift && g.away === "Seattle Seahawks" ? [44.5, -118, -102] : g.tot;
  return {
    id: String(401872900 + i),
    date: g.t.replace(":00Z", "Z"),
    competitions: [{
      competitors: [
        { homeAway: "home", team: { displayName: g.home } },
        { homeAway: "away", team: { displayName: g.away } },
      ],
      odds: [{
        provider: { id: "100", name: "DraftKings" },
        moneyline: { home: { close: { odds: sgn(ml[1]), link: dk(`0ML${i}_1`) } }, away: { close: { odds: sgn(ml[0]), link: dk(`0ML${i}_3`) } } },
        pointSpread: {
          home: { close: { line: sgn(-sp[0]), odds: sgn(sp[2]), link: dk(`0HC${i}_1`) } },
          away: { close: { line: sgn(sp[0]), odds: sgn(sp[1]), link: dk(`0HC${i}_3`) } },
        },
        total: {
          over: { close: { line: `o${tot[0]}`, odds: sgn(tot[1]), link: dk(`0OU${i}O_1`) } },
          under: { close: { line: `u${tot[0]}`, odds: sgn(tot[2]), link: dk(`0OU${i}U_3`) } },
        },
      }],
    }],
  };
}

// ---- SportsGameOdds (assumed shape from their docs) ----
let sgoCalls = 0;
function sgoEvent(g) {
  const drift = sgoCalls > 1;
  const odds = {};
  const put = (statID, ent, bet, side, book) => {
    const oddID = `${statID}-${ent}-game-${bet}-${side}`;
    odds[oddID] = { oddID, statID, statEntityID: ent, periodID: "game", betTypeID: bet, sideID: side, byBookmaker: { draftkings: { available: true, ...book } } };
  };
  put("points", "home", "ml", "home", { odds: sgn(g.ml[1]) });
  put("points", "away", "ml", "away", { odds: sgn(g.ml[0]) });
  put("points", "home", "sp", "home", { odds: sgn(g.sp[2]), spread: sgn(-g.sp[0]) });
  put("points", "away", "sp", "away", { odds: sgn(g.sp[1]), spread: sgn(g.sp[0]) });
  put("points", "all", "ou", "over", { odds: sgn(g.tot[1]), overUnder: String(g.tot[0]) });
  put("points", "all", "ou", "under", { odds: sgn(g.tot[2]), overUnder: String(g.tot[0]) });
  const players = {};
  for (const [name, kind, line, td] of PLAYERS[g.id] ?? []) {
    const pid = name.toUpperCase().replace(/[^A-Z ]/g, "").replace(/ /g, "_") + "_1_NFL";
    players[pid] = { playerID: pid, name };
    const stat = kind === "pass" ? "passing_yards" : kind === "rush" ? "rushing_yards" : "receiving_yards";
    const over = drift && name === "Jaxon Smith-Njigba" ? -125 : -115;
    put(stat, pid, "ou", "over", { odds: sgn(over), overUnder: String(line) });
    put(stat, pid, "ou", "under", { odds: "-115", overUnder: String(line) });
    put("touchdowns", pid, "yn", "yes", { odds: sgn(td) });
  }
  return {
    eventID: "SGO" + g.id.slice(0, 8),
    teams: { home: { names: { long: g.home } }, away: { names: { long: g.away } } },
    status: { startsAt: g.t },
    players,
    odds,
  };
}

const POOL_SEED = ["605898405117521920", "1065164963234271232", "565349860547133440", "1128911101363654656", "1022603316649414656", "1065765604533145600", "1067937915054952448"];
const tables = { legs: [], losers: [], parlays: [], odds_cache: [], sent_messages: [], push_subs: [], pool: POOL_SEED.map((user_id) => ({ user_id, active: true })) };
const keys = {
  legs: ["season", "week", "user_id"], losers: ["season", "week", "user_id"], parlays: ["season", "week"],
  odds_cache: ["key"], sent_messages: ["key"], push_subs: ["endpoint"], pool: ["user_id"],
};
const posted = [];
globalThis.__posted = posted;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function filters(params) {
  const fs = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "columns"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    fs.push([k, op, rest.join(".")]);
  }
  return (row) => fs.every(([k, op, val]) => op === "eq" && String(row[k]) === val);
}

async function rest(url, init) {
  const table = url.pathname.split("/").pop();
  const rows = tables[table];
  const method = (init?.method ?? "GET").toUpperCase();
  const match = filters(url.searchParams);
  const headers = new Headers(init?.headers);
  const body = init?.body ? JSON.parse(init.body) : null;
  if (method === "GET") {
    let out = rows.filter(match);
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === "desc" ? -1 : 1));
    }
    const limit = url.searchParams.get("limit");
    if (limit) out = out.slice(0, Number(limit));
    if ((headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
      return out.length ? json(out[0]) : json({ code: "PGRST116", message: "no rows" }, 406);
    }
    return json(out);
  }
  if (method === "POST") {
    const list = Array.isArray(body) ? body : [body];
    const upsert = (headers.get("prefer") ?? "").includes("merge-duplicates");
    const conflictCols = url.searchParams.get("on_conflict")?.split(",") ?? keys[table];
    for (const r of list) {
      const existing = rows.find((x) => conflictCols.every((c) => String(x[c]) === String(r[c])));
      if (existing && !upsert) return json({ code: "23505", message: "duplicate key" }, 409);
      if (existing) Object.assign(existing, r);
      else rows.push({ id: Math.random().toString(36).slice(2), created_at: new Date().toISOString(), ...r });
    }
    return new Response(null, { status: 201 });
  }
  if (method === "PATCH") {
    rows.filter(match).forEach((r) => Object.assign(r, body));
    return new Response(null, { status: 204 });
  }
  if (method === "DELETE") {
    tables[table] = rows.filter((r) => !match(r));
    return new Response(null, { status: 204 });
  }
  return json({ message: "unsupported" }, 400);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "api.sleeper.app") {
    const p = url.pathname;
    if (p.endsWith("/state/nfl")) return json({ week: 3, season: "2026", season_type: "regular", season_start_date: "2026-09-09" });
    if (p.endsWith("/users")) return json(users.map(([id, dn, tn]) => ({ user_id: id, display_name: dn, avatar: null, metadata: tn ? { team_name: tn } : {} })));
    if (p.endsWith("/rosters")) return json(users.map(([id, , , r]) => ({ roster_id: r, owner_id: id })));
    const m = p.match(/matchups\/(\d+)$/);
    if (m) {
      const pts = m[1] === "2" ? week2 : m[1] === "3" ? week3 : null;
      return json(pts ? pts.map((points, i) => ({ roster_id: i + 1, points, matchup_id: 1 })) : []);
    }
  }
  if (url.hostname === "site.api.espn.com") {
    espnCalls++;
    return json({ events: GAMES.map(espnEvent) });
  }
  if (url.hostname === "api.sportsgameodds.com") {
    if (init?.headers?.["X-Api-Key"] == null && !(new Headers(init?.headers).get("x-api-key"))) return json({ success: false, error: "no key" }, 401);
    sgoCalls++;
    return json({ success: true, data: GAMES.map(sgoEvent) });
  }
  if (url.hostname === "api.the-odds-api.com") {
    const headers = { "content-type": "application/json", "x-requests-remaining": "19412", "x-requests-used": "588" };
    const m = url.pathname.match(/events\/([^/]+)\/odds/);
    if (m) {
      const wanted = (url.searchParams.get("markets") ?? "").split(",");
      return new Response(JSON.stringify(propsEvent(m[1], wanted)), { headers });
    }
    gameCalls++;
    return new Response(JSON.stringify(GAMES.map(gameEvent)), { headers });
  }
  if (url.hostname === "mock.supabase.co") return rest(url, init);
  if (url.hostname === "discord.mock") { posted.push(JSON.parse(init.body).content); return new Response(null, { status: 204 }); }
  if (url.pathname === "/__posted") return json(posted);
  return realFetch(input, init);
};
