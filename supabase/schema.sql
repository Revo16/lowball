-- Lowball schema. Paste into Supabase -> SQL Editor -> Run.
-- All access goes through the app's server with the service_role key,
-- so RLS is enabled with no policies: the public anon key can read nothing.

create table if not exists legs (
  id            uuid primary key default gen_random_uuid(),
  season        text not null,
  week          int  not null,
  user_id       text not null,            -- Sleeper user_id of the picker
  event_id      text,                     -- Odds API event id (null for custom legs)
  commence_time timestamptz,
  game          text not null,            -- "Seattle Seahawks @ Los Angeles Rams"
  market        text not null,            -- h2h | spreads | totals | player_* | custom
  selection     text not null,            -- human label: "Seahawks -3.5"
  outcome_name  text,
  outcome_desc  text,
  point         numeric,
  price         int,                      -- American odds at pick time, null if unknown
  dk_link       text,                     -- DraftKings link that adds this bet to the betslip, when known
  entered_by    text,                     -- set when someone else entered it (texted-in pick)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (season, week, user_id)
);

create table if not exists losers (
  season      text not null,
  week        int  not null,
  user_id     text not null,
  points      numeric not null,
  tied        boolean not null default false,
  paid        boolean not null default false,  -- loser tapped "I paid"
  confirmed   boolean not null default false,  -- bookie confirmed receipt
  paid_at     timestamptz,
  created_at  timestamptz not null default now(),
  primary key (season, week, user_id)
);

create table if not exists parlays (
  season     text not null,
  week       int  not null,
  status     text not null default 'open',     -- open | placed | won | lost | void
  dk_odds    int,                              -- final American odds DraftKings gave
  stake      numeric,
  payout     numeric,
  note       text,
  placed_by  text,                             -- Sleeper user_id of whoever placed it (the week's "bookie")
  placed_at  timestamptz,
  settled_at timestamptz,
  primary key (season, week)
);

create table if not exists odds_cache (
  key        text primary key,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Phones that turned on notifications (for Nudge and reminders).
create table if not exists push_subs (
  endpoint   text primary key,
  user_id    text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Who's in this season. Only these teams pick legs and can finish last.
-- Change it any time from the Bookie tab (admin only).
create table if not exists pool (
  user_id    text primary key,               -- Sleeper user_id
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

-- No Shoes Nation, starting pool (Sept 2026)
insert into pool (user_id) values
  ('605898405117521920'),   -- The Lone Wolf (Revo16)
  ('1065164963234271232'),  -- The Hogfather (BigBadBerto)
  ('565349860547133440'),   -- Need for Shaheed (IAmEeb)
  ('1128911101363654656'),  -- Slippin' Tony (kobepop1)
  ('1022603316649414656'),  -- 4KTREY NUTTR (varunneti)
  ('1065765604533145600'),  -- tobiechip (smithz14)
  ('1067937915054952448')   -- oy vey my ACL (cbiesold)
on conflict (user_id) do nothing;

-- Dedupes cron messages so a retry never double-posts to the group chat.
create table if not exists sent_messages (
  key     text primary key,
  sent_at timestamptz not null default now()
);

alter table legs          enable row level security;
alter table losers        enable row level security;
alter table parlays       enable row level security;
alter table odds_cache    enable row level security;
alter table sent_messages enable row level security;
alter table push_subs     enable row level security;
alter table pool          enable row level security;

-- Upgrading from an earlier version:
alter table legs add column if not exists dk_link text;
alter table legs add column if not exists entered_by text;
alter table parlays add column if not exists placed_by text;
