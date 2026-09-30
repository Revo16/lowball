# Lowball

The No Shoes Nation punishment parlay, as a web app. Nobody downloads anything: it's a link that works in any phone browser, and adding it to the home screen gives it an icon and a full-screen view (iPhone: Share → Add to Home Screen; Android: menu → Install app).

**Three tabs:** The Slip, Find a bet, League.

- **The Slip** (home), where the whole week happens. Top: parlay odds, what it pays and each person's share. Then last week's loser (Owes $5 / Paid) with the **Week N bookie** row: a ? with a green **+** (tap after placing it to record odds, stake and your Venmo and become the bookie) and a **DK** button that opens the whole parlay in DraftKings (dim until every leg is in or picks lock; if some legs can't ride in the link it lists them first). The loser gets Pay on Venmo and **I paid** (counts right away, with Undo). Above the legs: **Poke** (push to everyone without a leg, once per 30 minutes) and **Copy** (the slip as text for the group chat). Below that is the parlay as a paper slip, where cards you can act on are raised: tap to change a leg or fill an empty slot, swipe left to remove (red edge), with Undo: one row per person, blank for anyone who hasn't picked. Each leg shows the current DraftKings price, with ▲/▼ against what it was when picked, and flags a line that moved (e.g. -2.5 became -3). Combined odds and payout update with it. The page refreshes itself every 30 seconds, so new picks and price moves just appear. Once someone marks it placed, prices freeze at the final odds.
- **Find a bet.** Every game's spread, total and moneyline in a DraftKings-style grid, plus search across every player prop ("walker", "chase td", "mahomes"), with filter chips for Spreads, Moneylines, Totals, Anytime TD, Pass/Rush/Rec yards. Tap a line to put it on the slip, or tap another to swap. Lines someone already took are greyed out with their name. Anything not listed can be added by hand.

**Money:** each week's last-place finisher funds the next week's parlay, so they pay whoever places it (the bookie). Their Pay on Venmo button shows up on The Slip as soon as someone taps I placed it, prefilled with the bookie's Venmo, $5 and a note; then they tap I paid, which counts right away and can be undone (by them, the bookie or the admin; League can also mark it paid). If the loser places it themselves, they're square. The pool's Venmo handles are in `src/lib/venmos.ts`; anyone can add or change their own on the League tab or when they tap I placed it (the `VENMOS` setting in Vercel can also override them). **Placing:** tap **DK** on The Slip, place it in DraftKings, then tap the **+** by Week N bookie. **Winnings:** this week's payout and share are on The Slip; the season total is on League. **Poke:** pushes everyone without a leg (once per 30 minutes); the Friday and Saturday reminders push too. **Admin** (`ADMIN_SLEEPER_USERNAME`): add/remove players, edit any week's parlay result, confirm $5 payments, fix or remove any leg before it's placed. Group-chat posts (Discord or GroupMe, optional) go out Tuesday (loser), Friday and Saturday (who hasn't picked), and after lock (final slip).

**Live tracking:** once it's placed, every card follows its game from ESPN's free live feeds (scoreboard + box score, refreshed every ~30 seconds): the score and clock, where the leg stands ("62 / 74.5 rec yds · needs 13", "Covering by 3.5", "No TD yet") with a progress bar, and HIT / MISS / PUSH on the card once it's decided. Overs that clear early and Unders that bust early are decided on the spot; spreads, moneylines and Unders otherwise wait for the final. A player who doesn't play voids his leg. The parlay settles itself: lost the moment a leg misses, won once every leg hits (pushes drop out and the payout is worked out), with one push and group-chat post. Typed-in bets and stats ESPN doesn't carry get Hit / Miss buttons for that week's bookie or the admin. Monday-night games are settled by the Tuesday job even if nobody has the app open. (`src/lib/grade.ts` grades, `src/lib/live.ts` reads ESPN, `src/lib/settle.ts` settles.)

## What it can't do, and why

- **Send Venmo requests automatically.** Venmo shut its API to new developers, so no app can request or move money for you. The prefilled pay link is the lowest-friction option that exists. Losers tap I paid; it can be undone.
- **Place the bet.** DraftKings has no public betting API. Whoever places it opens the one-tap parlay link, adds any props by hand, and places it.
- **Guarantee the odds.** Leg prices are DraftKings' lines (via ESPN and SportsGameOdds) at pick time. Lines move, and DraftKings reprices same-game legs as an SGP, so the estimate on the slip can differ from what DraftKings gives. The person placing it enters the real number after placing it.

## Setup (about an hour, all free tiers)

### 1. Supabase (database)
1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. Project Settings → API: copy the **Project URL** and the **service_role** key.

### 2. Odds (free)
- **Spreads, totals, moneylines:** ESPN's public scoreboard feed, which carries DraftKings' lines. No key, no limit, refreshed every 5 minutes. It also includes DraftKings links that open the sportsbook with that bet on the betslip, which the DK button on The Slip is built from. The feed is unofficial, so if ESPN changes it the app falls back to SportsGameOdds for game lines.
- **Player props:** sign up for the free plan at [sportsgameodds.com](https://sportsgameodds.com) (no card) and set `SGO_API_KEY`. The free plan allows 2,500 games a month; one pull of the whole week's slate is ~15. The app spreads the month's allowance evenly, so props refresh roughly every 1–3 hours and faster when usage has been light. League shows usage.
- Run `SGO_API_KEY=... node scripts/check-odds.mjs` once after signing up. It confirms both feeds return DraftKings data in the shape the app reads.
- No SportsGameOdds key: everything works except prop search. Props can still be added by hand.
- `ODDS_API_KEY` (The Odds API, paid) is still supported as a props source if you ever want faster prop refreshes.

### 3. Push notifications
1. Run `npx web-push generate-vapid-keys` once and put the two keys in `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.
2. Each person turns them on from the card at the top of The Slip. **iPhone:** Share → Add to Home Screen first, open Lowball from the Home Screen, then tap Turn on (Apple only allows web push for installed apps, iOS 16.4+). **Android/desktop:** works in the browser.
3. Poke tells you who it couldn't reach (notifications off).

### 4. Group chat (optional but it's what kills the friction)
- **Discord:** channel settings → Integrations → Webhooks → New Webhook → Copy URL.
- **GroupMe:** [dev.groupme.com/bots](https://dev.groupme.com/bots) → Create Bot in your league chat → copy the Bot ID.
- iMessage group chats can't take bot messages. If that's your chat, skip this and anyone can tap Copy on The Slip and paste it.

### 5. Deploy to Vercel
1. Push this folder to a GitHub repo.
2. [vercel.com](https://vercel.com) → Add New Project → import the repo.
3. Add every variable from `.env.example` under Environment Variables. Generate `SESSION_SECRET` and `CRON_SECRET` with `openssl rand -hex 32`. Set `APP_URL` to the URL Vercel gives you.
4. Deploy. The schedules in `vercel.json` register automatically.

### 6. Tell the league
Post the link and the `LEAGUE_PIN` in the group chat. Each person picks their team from the Sleeper list and enters the PIN once; they stay signed in for the season.

### Fill these in before deploying
- `ADMIN_SLEEPER_USERNAME`: your Sleeper name (Revo16). Manages the pool, confirms payments, pays back whoever places the bet.
- `PAY_TO_VENMO`: your own Venmo username, no @ (used when you're the bookie).
- `VENMOS` (optional): overrides for the Venmo handles in `src/lib/venmos.ts`, as `sleeperUserId=handle,sleeperUserId=handle`.
- The starting pool (7 teams) is seeded by `supabase/schema.sql`; change it later on the League tab.
- `LOSER_PICKS`: `true` if the loser still picks a leg on the parlay they're funding, `false` to sit them out.

## Schedule

Crons run in UTC on Vercel. Hobby-plan crons can fire up to an hour late, which is fine: the lock is enforced in code at exactly 8:00 PM PT, and the crons only send messages.

| When (Pacific) | Route | What happens |
|---|---|---|
| Tue 10 AM (9 AM in winter) | `/api/cron/loser` | Records last week's lowest scorer, posts to chat |
| Fri 6 PM | `/api/cron/remind?slot=fri` | Lists who hasn't picked |
| Sat noon | `/api/cron/remind?slot=sat` | Second nudge |
| Sat 9:05 PM (8:05 PM in winter) | `/api/cron/lock` | Posts the final slip for whoever places it |

Each message is sent once per week even if a cron retries. To trigger one by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/loser`.

## Rules the app enforces

- One leg per person per week. Picking again replaces your leg until lock.
- **Early games (Thursday night, Saturday, London):** any game can go on the slip until 15 minutes before its kickoff. If the parlay isn't placed (and marked I placed it) by then, legs on that game come off the slip and their owners get a push to pick again. The Slip marks those legs "Drops Thu 5:00 PM", the DK sheet warns whoever is placing it, and a cron runs right after Thursday's and Sunday morning's cutoffs (the app also checks whenever anyone opens it).
- **Adding a bet by hand:** pick the game from a dropdown (only games still open), and the odds have a −/+ switch since phone number pads have no minus key.
- **Props:** every full-game DraftKings player prop SportsGameOdds carries (receptions, passing TDs, first TD, 2+ TDs, rush + rec yards, tackles, kicking and so on) plus team totals, not just the four originals. `node scripts/check-odds.mjs` lists every prop type the feed has this week.
- Two people can't take the same market in the same game (both sides of a spread, say), since DraftKings won't take that parlay. Different markets in the same game are allowed with an SGP warning.
- Ties for last: everyone tied owes, and the stake scales up.
- Stat corrections or pool changes: anyone can re-pull a week's loser from the League tab. Anyone who already paid stays on the books.
- **A leg you pick yourself is yours:** only you can change or remove it, until the lock; the admin can still fix it. **A leg someone entered for you** (texted-in picks) is tagged "Entered by …" and anyone can change or remove it until the parlay is placed; the owner gets a push either way. Re-pick it yourself and it's locked to you.
- **Slip cards:** cards you can act on are raised. Tap to change (or, on an empty slot with a blue +, add a pick for that player); swipe left to remove (red edge, with Undo). You can act on your own leg until the lock, any leg entered for someone until it's placed, and every leg if you're the admin. Other players' own picks sit flat with a lock.
- **Find a bet is always you.** Picking for someone else starts by tapping their card on The Slip, and shows a yellow "Picking for …" bar; ✕ takes you back to your own leg.

## Try it locally without any accounts

`scripts/mock.cjs` stubs Sleeper, the odds feed, Supabase and Discord with your league's real Week 2 data so you can click through every screen:

```bash
npm install
npm run build
cp .env.example .env.local   # then set:
# SUPABASE_URL=https://mock.supabase.co  SUPABASE_SERVICE_ROLE_KEY=x  SGO_API_KEY=x
# DISCORD_WEBHOOK_URL=https://discord.mock/hook  ADMIN_SLEEPER_USERNAME=Revo16
# PAY_TO_VENMO=test  LEAGUE_PIN=1234  SESSION_SECRET=anything  CRON_SECRET=anything
NODE_OPTIONS="--require ./scripts/mock.cjs" npx next start
```

`npm test` runs the week-calendar, odds and loser-calculation tests.

## Code map

```
src/lib/weeks.ts     NFL week math in Pacific time (lock, rollover, DST)
src/lib/math.ts      American/decimal odds, parlay price, lowest scorer
src/lib/sleeper.ts   League members, matchups, live bottom three
src/lib/odds.ts      Odds sources, shared cache, SportsGameOdds monthly budget
src/lib/providers/   ESPN (game lines + betslip links) and SportsGameOdds (props) adapters
src/lib/jobs.ts      Loser recording, slip text, chat messages
src/lib/session.ts   Team + PIN sign-in, signed cookie
src/lib/venmo.ts     Prefilled Venmo pay link
src/lib/lines.ts     Live price lookup, line-moved detection, conflict rule (pure)
src/lib/slip.ts      Everything The Slip shows, as JSON (/api/slip)
src/lib/board.ts     Game lines + props for Find a bet (/api/board)
src/components/SlipView.tsx    The Slip, polls every 30s
src/components/SearchView.tsx  Find a bet, instant client-side search
src/components/Sheets.tsx  DK and I placed it sheets
src/app/api/cron/    Tuesday loser, reminders, lock
```

## A note on DraftKings rules

DraftKings' terms say an account is for the account holder's own wagering, and pooling friends' money into one account is a gray area there. At $5 a week it's a group joke, but it's the placer's account on the line, so whoever places it should know.
