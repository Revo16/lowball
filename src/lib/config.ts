import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export function normalizeSupabaseUrl(raw: string) {
  return raw.trim().replace(/\/+$/, "").replace(/\/(rest|auth|storage)\/v1$/i, "").replace(/\/+$/, "");
}

export const config = {
  get leagueId() { return required("SLEEPER_LEAGUE_ID"); },
  /** Runs the league in the app: manages the pool, confirms payments, pays back whoever places the bet. */
  get adminUsername() { return (process.env.ADMIN_SLEEPER_USERNAME ?? "").trim().toLowerCase(); },
  /** Where every loser sends their $5. */
  get payToVenmo() { return required("PAY_TO_VENMO").trim().replace(/^@/, ""); },
  get loserAmount() { return Number(process.env.LOSER_AMOUNT ?? 5); },
  get loserPicks() { return (process.env.LOSER_PICKS ?? "true") === "true"; },
  get leaguePin() { return required("LEAGUE_PIN"); },
  get sessionSecret() { return required("SESSION_SECRET"); },
  get cronSecret() { return required("CRON_SECRET"); },
  /** Accepts the base URL even if it was pasted with /rest/v1 or a trailing slash. */
  get supabaseUrl() { return normalizeSupabaseUrl(required("SUPABASE_URL")); },
  get supabaseKey() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get oddsKey() { return process.env.ODDS_API_KEY ?? ""; },
  get discordWebhook() { return process.env.DISCORD_WEBHOOK_URL ?? ""; },
  get groupmeBotId() { return process.env.GROUPME_BOT_ID ?? ""; },
  get appUrl() { return (process.env.APP_URL ?? "").replace(/\/$/, ""); },
};
