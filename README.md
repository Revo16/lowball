# Lowball

The No Shoes Nation punishment parlay, as a web app. Nobody downloads anything: it's a link that works in any phone browser, and adding it to the home screen gives it an icon and a full-screen view (iPhone: Share → Add to Home Screen; Android: menu → Install app).

**Two tabs:**

- **The Slip** (home). Last week's last-place finisher and whether they've paid (Owes $5 / Says paid / Paid) sit at the top. Below that is the parlay as a paper slip: one row per person, blank for anyone who hasn't picked. Each leg shows the current DraftKings price, with ▲/▼ against what it was when picked, and flags a line that moved (e.g. -2.5 became -3). Combined odds and payout update with it. The page refreshes itself every 30 seconds, so new picks and price moves just appear. Once someone marks it placed, prices freeze at the final odds.
- **Find a bet.** Every game's spread, total and moneyline in a DraftKings-style grid, plus search across every player prop ("walker", "chase td", "mahomes"), with filter chips for Spreads, Moneylines, Totals, Anytime TD, Pass/Rush/Rec yards. Tap a line to put it on the slip, or tap another to swap. Lines someone already took are greyed out with their name. Anything not listed can be added by hand.

**Money:** every loser pays one Venmo (the admin's, `PAY_TO_VENMO`) with a one-tap **Pay on Venmo** button, then taps **I paid**; the admin taps **Got it** when it lands. **Placing:** nobody claims anything. Once all legs are in (or picks lock), the **Bookie** tab shows one **Open parlay in DraftKings** button that loads every spread, total and moneyline leg onto a single betslip; props and typed-in bets get added by hand. Whoever places it taps **I placed it** and shows up as that week's bookie. **Winnings:** under the slip, this week's payout if it hits and the season's total, each also split per person. **Nudge:** one button pushes a notification to every pool member without a leg (once per 30 minutes); the Friday and Saturday reminders push too. **Admin** (`ADMIN_SLEEPER_USERNAME`): add/remove players, edit any week's parlay result, confirm $5 payments, fix or remove any leg before it's placed. Group-chat posts (Discord or GroupMe, optional) go out Tuesday (loser), Friday and Saturday (who hasn't picked), and after lock (final slip).

## What it can't do, and why

- **Send Venmo requests automatically.** Venmo shut its API to new developers, so no app can request or move money for you. The prefilled pay link is the lowest-friction option that exists. The admin confirms receipt on the Bookie tab.
- **Place the bet.** DraftKings has no public betting API. Whoever places it opens the one-tap parlay link, adds any props by hand, and places it.
- **Guarantee the odds.** Leg prices are DraftKings' lines (via ESPN and SportsGameOdds) at pick time. Lines move, and DraftKings reprices same-game legs as an SGP, so the estimate on the slip can differ from what DraftKings gives. The person placing it enters the real number after placing it.

## Setup (about an hour, all free tiers)

### 1. Supabase (database)
1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. Project Settings → API: copy the **Project URL** and the **service_role** key.

### 2. Odds (free)
- **Spreads, totals, moneylines:** ESPN's public scoreboard feed, which carries DraftKings' lines. No key, no limit, refreshed every 5 minutes. It also includes DraftKings links that open the sportsbook with that bet on the betslip, which the one-tap parlay link on the Bookie tab is built from. The feed is unofficial, so if ESPN changes it the app falls back to SportsGameOdds for game lines.
- **Player props:** sign up for the free plan at [sportsgameodds.com](https://sportsgameodds.com) (no card) and set `SGO_API_KEY`. The free plan allows 2,500 games a month; one pull of the whole week's slate is ~15. The app spreads the month's allowance evenly, so props refresh roughly every 1–3 hours and faster when usage has been light. The bookie tab shows usage.
- Run `SGO_API_KEY=... node scripts/check-odds.mjs` once after signing up. It confirms both feeds return DraftKings data in the shape the app reads.
- No SportsGameOdds key: everything works except prop search. Props can still be added by hand.
- `ODDS_API_KEY` (The Odds API, paid) is still supported as a props source if you ever want faster prop refreshes.

### 3. Push notifications
1. Run `npx web-push generate-vapid-keys` once and put the two keys in `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.
2. Each person turns them on from the card at the top of The Slip. **iPhone:** Share → Add to Home Screen first, open Lowball from the Home Screen, then tap Turn on (Apple only allows web push for installed apps, iOS 16.4+). **Android/desktop:** works in the browser.
3. The Bookie tab marks who has notifications off, and Nudge tells you who it couldn't reach.

### 4. Group chat (optional but it's what kills the friction)
- **Discord:** channel settings → Integrations → Webhooks → New Webhook → Copy URL.
- **GroupMe:** [dev.groupme.com/bots](https://dev.groupme.com/bots) → Create Bot in your league chat → copy the Bot ID.
- iMessage group chats can't take bot messages. If that's your chat, skip this and anyone can copy the slip from the Bookie tab.

### 5. Deploy to Vercel
1. Push this folder to a GitHub repo.
2. [vercel.com](https://vercel.com) → Add New Project → import the repo.
3. Add every variable from `.env.example` under Environment Variables. Generate `SESSION_SECRET` and `CRON_SECRET` with `openssl rand -hex 32`. Set `APP_URL` to the URL Vercel gives you.
4. Deploy. The schedules in `vercel.json` register automatically.

### 6. Tell the league
Post the link and the `LEAGUE_PIN` in the group chat. Each person picks their team from the Sleeper list and enters the PIN once; they stay signed in for the season.

### Fill these in before deploying
- `ADMIN_SLEEPER_USERNAME`: your Sleeper name (Revo16). Manages the pool, confirms payments, pays back whoever places the bet.
- `PAY_TO_VENMO`: your Venmo username, no @. Every loser pays here.
- The starting pool (7 teams) is seeded by `supabase/schema.sql`; change it later on the Bookie tab.
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
- Only games that kick off after the Saturday lock are listed, so they can actually be bet.
- Two people can't take the same market in the same game (both sides of a spread, say), since DraftKings won't take that parlay. Different markets in the same game are allowed with an SGP warning.
- Ties for last: everyone tied owes, and the stake scales up.
- Stat corrections or pool changes: anyone can re-pull a week's loser from the Bookie tab. Anyone who already paid stays on the books.
- **A leg you pick yourself is yours:** only you can change or remove it (on Find a bet), until the lock; the admin can still fix it. **A leg someone entered for you** (texted-in picks, via **Enter for them**) is tagged "Entered by …" and anyone can change it or remove it until the parlay is placed; the owner gets a push either way. Re-pick it yourself and it's locked to you. On the Bookie tab every leg is its own card, Gmail-style: a neon-yellow left edge means swipe right to change, a red right edge means swipe left to remove (with Undo). A card swipes both ways or not at all: your own leg until the lock, any leg entered for someone until it's placed, and every leg for the admin. Other players' own picks show a lock.

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
src/app/bookie/      Bookie tab: one-tap parlay, I placed it, payments, player pool
src/app/api/cron/    Tuesday loser, reminders, lock
```

## A note on DraftKings rules

DraftKings' terms say an account is for the account holder's own wagering, and pooling friends' money into one account is a gray area there. At $5 a week it's a group joke, but it's the placer's account on the line, so whoever places it should know.
