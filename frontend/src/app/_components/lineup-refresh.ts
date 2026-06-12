// Live lineup refresh — fetches today's posted MLB lineups from the public
// MLB Stats API and returns the set of confirmed starter names.
//
// The set is persisted to localStorage keyed by date so subsequent page loads
// keep the override until the user clicks refresh again.

const LS_KEY_PREFIX = "lineup-override:";

export type LineupOverride = {
  date: string;             // YYYY-MM-DD
  starters: string[];       // confirmed starter names
  fetchedAt: number;        // unix ms — when we pulled the data
  gamesWithLineups: number; // how many games had posted lineups
};

// MLB Stats API — public, no auth. hydrate=person,lineups gets starter names.
const SCHEDULE_URL = (date: string) =>
  `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=lineups,probablePitcher,person`;

type ScheduleGame = {
  gamePk: number;
  status?: { detailedState?: string; abstractGameState?: string };
  lineups?: {
    homePlayers?: Array<{ fullName?: string }>;
    awayPlayers?: Array<{ fullName?: string }>;
  };
  teams?: {
    home?: { team?: { abbreviation?: string } };
    away?: { team?: { abbreviation?: string } };
  };
};

export async function fetchLiveLineups(date: string): Promise<LineupOverride> {
  const url = SCHEDULE_URL(date);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`MLB API ${resp.status}`);
  const data = await resp.json();

  const starters = new Set<string>();
  let gamesWithLineups = 0;

  const dates = data?.dates ?? [];
  for (const dateBlock of dates) {
    const games: ScheduleGame[] = dateBlock?.games ?? [];
    for (const g of games) {
      // Skip postponed/cancelled games
      const state = g?.status?.detailedState?.toLowerCase() ?? "";
      if (state.includes("postponed") || state.includes("cancelled") || state.includes("canceled")) {
        continue;
      }
      const home = g?.lineups?.homePlayers ?? [];
      const away = g?.lineups?.awayPlayers ?? [];
      let hasAnyPosted = false;
      for (const p of home) {
        if (p?.fullName) {
          starters.add(p.fullName);
          hasAnyPosted = true;
        }
      }
      for (const p of away) {
        if (p?.fullName) {
          starters.add(p.fullName);
          hasAnyPosted = true;
        }
      }
      if (hasAnyPosted) gamesWithLineups += 1;
    }
  }

  return {
    date,
    starters: Array.from(starters),
    fetchedAt: Date.now(),
    gamesWithLineups,
  };
}

export function loadOverride(date: string): LineupOverride | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY_PREFIX + date);
    if (!raw) return null;
    return JSON.parse(raw) as LineupOverride;
  } catch {
    return null;
  }
}

export function saveOverride(o: LineupOverride): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY_PREFIX + o.date, JSON.stringify(o));
  } catch {
    /* quota — ignore */
  }
}

export function clearOverride(date: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY_PREFIX + date);
  } catch {
    /* ignore */
  }
}
