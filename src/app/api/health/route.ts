import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/health: checks each setting and connection, and says which one is
// broken. Never shows secret values, only whether they're set and working.

const REQUIRED = [
  "SLEEPER_LEAGUE_ID",
  "PAY_TO_VENMO",
  "LEAGUE_PIN",
  "SESSION_SECRET",
  "CRON_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const OPTIONAL = ["ADMIN_SLEEPER_USERNAME", "SGO_API_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "APP_URL"];
const TABLES = ["legs", "losers", "parlays", "odds_cache", "sent_messages", "push_subs", "pool"];

type Check = { ok: boolean; detail: string };

export async function GET() {
  const checks: Record<string, Check> = {};

  for (const name of REQUIRED) {
    const v = process.env[name];
    checks[`setting ${name}`] = v
      ? { ok: !/FILL_ME/.test(v), detail: /FILL_ME/.test(v) ? "still says FILL_ME" : "set" }
      : { ok: false, detail: "missing: add it in Vercel and redeploy" };
  }
  for (const name of OPTIONAL) {
    const v = process.env[name];
    checks[`setting ${name} (optional)`] = { ok: true, detail: v ? (/FILL_ME/.test(v) ? "still says FILL_ME" : "set") : "not set" };
  }

  const url = process.env.SUPABASE_URL ?? "";
  if (url) {
    const looksRight = /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url.trim());
    checks["SUPABASE_URL format"] = {
      ok: looksRight,
      detail: looksRight ? url.trim() : `"${url.trim().slice(0, 60)}" should look like https://abcd1234.supabase.co (no /rest/v1, no dashboard link)`,
    };
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (key) {
    const kind = key.startsWith("sb_secret_")
      ? "secret key (correct)"
      : key.startsWith("sb_publishable_")
        ? "PUBLISHABLE key: wrong one, use the secret key"
        : key.split(".").length === 3
          ? "legacy JWT key (fine if it's service_role, not anon)"
          : "unrecognized format";
    checks["SUPABASE_SERVICE_ROLE_KEY type"] = { ok: !kind.includes("wrong") && kind !== "unrecognized format", detail: kind };
  }

  if (url && key) {
    for (const t of TABLES) {
      try {
        const r = await db().from(t).select("*", { count: "exact", head: true });
        checks[`table ${t}`] = r.error
          ? { ok: false, detail: r.error.message.includes("does not exist") || r.error.code === "42P01" || r.error.code === "PGRST205"
              ? "missing: run supabase/schema.sql in the SQL Editor of THIS project"
              : r.error.message }
          : { ok: true, detail: `${r.count ?? 0} rows` };
      } catch (err) {
        checks[`table ${t}`] = { ok: false, detail: (err as Error).message };
      }
    }
  }

  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", { cache: "no-store" });
    checks["ESPN odds feed"] = { ok: r.ok, detail: r.ok ? "reachable" : `status ${r.status}` };
  } catch (err) {
    checks["ESPN odds feed"] = { ok: false, detail: (err as Error).message };
  }

  try {
    const r = await fetch(`https://api.sleeper.app/v1/league/${process.env.SLEEPER_LEAGUE_ID}`, { cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    checks["Sleeper league"] = { ok: !!j?.name, detail: j?.name ?? `status ${r.status}` };
  } catch (err) {
    checks["Sleeper league"] = { ok: false, detail: (err as Error).message };
  }

  const failing = Object.entries(checks).filter(([, c]) => !c.ok).map(([k]) => k);
  return NextResponse.json(
    { ok: failing.length === 0, failing, checks },
    { status: failing.length ? 500 : 200, headers: { "cache-control": "no-store" } },
  );
}
