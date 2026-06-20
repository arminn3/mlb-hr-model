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
  /** Replacement pitcher's MLB person id — used to fetch their split stats */
  replacementId?: number;
  /** Replacement pitcher's throwing hand — important for platoon flips */
  replacementHand: "L" | "R";
  /** Pitcher_score the replacement projects to vs LHB (0-1). Computed from
   *  MLB Stats API split stats using the same formula as backend
   *  `_pitcher_score_from_profile_row`. Falls back to 0.5 if fetch fails. */
  pitcherScoreVsL?: number;
  /** Pitcher_score vs RHB */
  pitcherScoreVsR?: number;
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

/** Fetch the replacement pitcher's vs-L / vs-R split stats from MLB Stats API
 *  and compute pitcher_score the same way the backend's
 *  `_pitcher_score_from_profile_row` does (ISO 35%, HR/9 35%, HR/FB 15%,
 *  FB% 10%, HR volume 5%). Returns 0.5 / 0.5 on any failure so the UI doesn't
 *  break — the user still gets the platoon-flip banner. */
export async function fetchReplacementPitcherScores(personId: number): Promise<{ vsL: number; vsR: number }> {
  const year = new Date().getFullYear();
  const url = `https://statsapi.mlb.com/api/v1/people/${personId}/stats?stats=statSplits&season=${year}&group=pitching&sitCodes=vl,vr`;

  function n(v: number, lo: number, hi: number) {
    return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  }
  function score(splitStat: Record<string, unknown>): number {
    const iso        = parseFloat(String(splitStat?.slg ?? 0)) - parseFloat(String(splitStat?.avg ?? 0));
    const hrPer9     = parseFloat(String(splitStat?.homeRunsPer9 ?? 0));
    const hr         = parseFloat(String(splitStat?.homeRuns ?? 0));
    const fb         = parseFloat(String(splitStat?.flyOuts ?? 0));
    // hr_fb is HRs / fly balls. MLB API gives flyOuts (outs) so we approximate
    // total FB as flyOuts + homeRuns (HRs are also fly balls). Conservative.
    const fbTotal = fb + hr;
    const hrFb       = fbTotal > 0 ? hr / fbTotal : 0;
    // FB rate as % of BIP — approximation using inningsPitched as denominator
    const ip         = parseFloat(String(splitStat?.inningsPitched ?? 0));
    const fbPct      = ip > 0 ? fb / (ip * 3) : 0;

    const fIso   = n(iso,    0.08, 0.24);
    const fHr9   = n(hrPer9, 0.0,  2.4);
    const fHrFb  = n(hrFb,   0.0,  0.24);
    const fFb    = n(fbPct,  0.04, 0.20);
    const fHrTot = n(hr / 20.0, 0.0, 1.0);
    return fIso * 0.35 + fHr9 * 0.35 + fHrFb * 0.15 + fFb * 0.10 + fHrTot * 0.05;
  }

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`MLB API ${resp.status}`);
    const data = await resp.json();
    type Split = { split?: { code?: string }; stat?: Record<string, unknown> };
    const splits: Split[] = data?.stats?.[0]?.splits ?? [];
    let vsL = 0.5, vsR = 0.5;
    for (const s of splits) {
      const code = s?.split?.code;
      if (code === "vl" && s.stat) vsL = score(s.stat);
      else if (code === "vr" && s.stat) vsR = score(s.stat);
    }
    return { vsL, vsR };
  } catch {
    return { vsL: 0.5, vsR: 0.5 };
  }
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
