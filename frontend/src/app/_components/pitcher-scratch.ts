// Manual override for scratched starting pitchers. The slate is locked once
// the first game starts, so we can't recompute pitcher_score on the fly —
// but we CAN flag the pitcher as scratched + name the replacement so the
// user knows the ratings on that game's batters are stale.

const LS_KEY_PREFIX = "pitcher-scratch:";

export type PitcherScratch = {
  /** Which game (gamePk) the scratch applies to */
  gamePk: number;
  /** Which side (away pitcher or home pitcher) was scratched */
  side: "away" | "home";
  /** Original (now scratched) pitcher name — for the banner */
  originalName: string;
  /** Replacement pitcher name (the one actually starting) */
  replacementName: string;
  /** Replacement pitcher's throwing hand — important for platoon flips */
  replacementHand: "L" | "R";
  /** When the user marked it */
  markedAt: number;
};

export type ScratchMap = Record<number, Record<"away" | "home", PitcherScratch | undefined>>;

const key = (date: string) => LS_KEY_PREFIX + date;

export function loadScratches(date: string): ScratchMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key(date));
    if (!raw) return {};
    return JSON.parse(raw) as ScratchMap;
  } catch {
    return {};
  }
}

export function saveScratch(date: string, scratch: PitcherScratch): ScratchMap {
  const all = loadScratches(date);
  const gameMap = all[scratch.gamePk] ?? {};
  gameMap[scratch.side] = scratch;
  all[scratch.gamePk] = gameMap;
  try {
    window.localStorage.setItem(key(date), JSON.stringify(all));
  } catch { /* quota — ignore */ }
  return all;
}

export function clearScratch(date: string, gamePk: number, side: "away" | "home"): ScratchMap {
  const all = loadScratches(date);
  const gameMap = all[gamePk];
  if (gameMap) {
    delete gameMap[side];
    if (!gameMap.away && !gameMap.home) delete all[gamePk];
  }
  try {
    window.localStorage.setItem(key(date), JSON.stringify(all));
  } catch { /* ignore */ }
  return all;
}
