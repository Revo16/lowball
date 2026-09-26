import "server-only";
import { config } from "./config";
import { lowestInPool, type MatchupRow } from "./math";
import { poolIds } from "./pool";

const BASE = "https://api.sleeper.app/v1";

async function get<T>(path: string, revalidate: number): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Sleeper ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export type NflState = {
  week: number;
  season: string;
  season_type: string;
  season_start_date: string;
};

export type Member = {
  userId: string;
  username: string;   // Sleeper display name, e.g. "Revo16"
  teamName: string;   // falls back to username
  rosterId: number;
  avatar: string | null;
  isAdmin: boolean;  // ADMIN_SLEEPER_USERNAME
  inPool: boolean;   // playing this season
};

/** Accepts a team picture URL (from the league) or a Sleeper profile avatar id. */
export function avatarUrl(avatar: string | null): string | null {
  if (!avatar) return null;
  if (/^(https?:\/\/|data:image\/)/.test(avatar)) return avatar;
  return `https://sleepercdn.com/avatars/thumbs/${avatar}`;
}

export async function nflState(): Promise<NflState> {
  return get<NflState>("/state/nfl", 600);
}

/** League members joined with their roster ids. Cached for an hour. */
export async function members(): Promise<Member[]> {
  const [users, rosters] = await Promise.all([
    get<Array<{ user_id: string; display_name: string; avatar: string | null; metadata?: { team_name?: string; avatar?: string } }>>(
      `/league/${config.leagueId}/users`, 3600),
    get<Array<{ roster_id: number; owner_id: string | null }>>(`/league/${config.leagueId}/rosters`, 3600),
  ]);
  const rosterByOwner = new Map(rosters.filter((r) => r.owner_id).map((r) => [r.owner_id!, r.roster_id]));
  const list = users
    .filter((u) => rosterByOwner.has(u.user_id))
    .map((u) => ({
      userId: u.user_id,
      username: u.display_name,
      teamName: u.metadata?.team_name?.trim() || u.display_name,
      rosterId: rosterByOwner.get(u.user_id)!,
      // The team picture set for this league (what the Sleeper app shows),
      // falling back to their personal profile picture.
      avatar: u.metadata?.avatar?.trim() || u.avatar,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
  const pool = await poolIds().catch(() => null);
  const admin = config.adminUsername;
  return list.map((m) => ({
    ...m,
    isAdmin: !!admin && m.username.toLowerCase() === admin,
    inPool: pool ? pool.has(m.userId) : true,
  }));
}

export async function matchups(week: number, revalidate = 300): Promise<MatchupRow[]> {
  const rows = await get<Array<{ roster_id: number; points: number | null }>>(
    `/league/${config.leagueId}/matchups/${week}`, revalidate);
  return rows.map((r) => ({ roster_id: r.roster_id, points: r.points }));
}

/** Everyone who finished last for a completed week, with their score. */
export async function weekLosers(week: number) {
  const [rows, people] = await Promise.all([matchups(week, 0), members()]);
  const low = lowestInPool(rows, new Set(people.filter((m) => m.inPool).map((m) => m.rosterId)));
  if (!low) return null;
  const byRoster = new Map(people.map((m) => [m.rosterId, m]));
  return {
    points: low.points,
    tied: low.rosterIds.length > 1,
    members: low.rosterIds.map((id) => byRoster.get(id)).filter((m): m is Member => !!m),
  };
}

/** Live standings for an in-progress week, lowest first. */
export async function liveBottom(week: number, count = 3) {
  const [rows, people] = await Promise.all([matchups(week, 120), members()]);
  const byRoster = new Map(people.map((m) => [m.rosterId, m]));
  return rows
    .filter((r) => byRoster.get(r.roster_id)?.inPool)
    .map((r) => ({ member: byRoster.get(r.roster_id)!, points: r.points ?? 0 }))
    .sort((a, b) => a.points - b.points)
    .slice(0, count);
}
