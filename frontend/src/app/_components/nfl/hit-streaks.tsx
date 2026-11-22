"use client";

import { useMemo, useState } from "react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflPlayer } from "./types";
import { teamLogo, matchupColor, matchupLabel, posColor } from "./format";
import { colsFor, roleLabel, type ColDef } from "./player-research";

// A "100%" streak means every game in the recent window cleared a FLOOR —
// not a fixed, universal number (a true alpha WR1 clearing 20 yards every
// game is meaningless noise), but not his own average either. Yards is a
// high-variance stat even for elite players (Justin Jefferson's own game
// log this season: 92, 55, 32, 79, 44, 33, 58 — a ~60-yard spread), so
// requiring every recent game to clear his OWN mean is nearly impossible by
// construction (roughly half of any sample sits below its own average) —
// that produced an empty tab most weeks, not a useful one.
//
// Instead, the floor is each player's own 20th-percentile game from his
// PRIOR history — i.e. a personalized "he rarely has it worse than this"
// level — computed ONLY from games BEFORE the recent window being tested
// (never the same games), so there's no tautology (the floor can't simply
// be drawn from inside the window it's grading). A "100%" streak then
// means: he hasn't had a game below his own rough floor in his last
// L5/L10 games. Still fully personalized (CeeDee Lamb's floor is CeeDee
// Lamb's floor, not 20 universal yards) and genuinely achievable/rare.
const WINDOWS = [5, 10] as const;
// Need real prior history (games BEFORE the tested window) to set a
// trustworthy floor — too few and the "floor" is just one random game.
const MIN_PRIOR = 3;
const FLOOR_PCT = 0.2;

type Streak = { player: NflPlayer; col: ColDef; games: number; floor: number; priorAvg: number };

function floorFrom(vals: number[], pct: number): number {
  const sorted = [...vals].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * pct) - 1);
  return sorted[idx];
}

function computeStreaks(slate: NflSlate, windowN: number): Streak[] {
  const out: Streak[] = [];
  for (const g of slate.games) {
    for (const p of g.players) {
      if (!p.role || !p.game_log?.length) continue;
      const sorted = [...p.game_log].sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length <= windowN) continue; // no prior history left to set a floor from
      const recent = sorted.slice(-windowN);
      const prior = sorted.slice(0, -windowN);
      if (prior.length < MIN_PRIOR) continue;
      for (const col of colsFor(p.pos)) {
        if (col.key === "atd") {
          // Binary stat — "100%" just means scored in every recent game,
          // no floor/average ambiguity to resolve.
          const vals = recent.map((r) => Number(r.atd ?? 0));
          if (vals.every((v) => v > 0)) out.push({ player: p, col, games: recent.length, floor: 1, priorAvg: 1 });
          continue;
        }
        const priorVals = prior.map((r) => Number(r[col.key] ?? 0));
        const floor = floorFrom(priorVals, FLOOR_PCT);
        if (col.invert || floor <= 0) continue; // INT-style stats don't have a meaningful "floor to clear"
        const recentVals = recent.map((r) => Number(r[col.key] ?? 0));
        if (recentVals.every((v) => v >= floor)) {
          const priorAvg = priorVals.reduce((s, x) => s + x, 0) / priorVals.length;
          out.push({ player: p, col, games: recent.length, floor, priorAvg });
        }
      }
    }
  }
  return out;
}

const INJURY_COLOR: Record<string, string> = { Out: color.red, Doubtful: color.red, Questionable: color.yellow };

function StreakRow({ s }: { s: Streak }) {
  const p = s.player;
  const mColor = matchupColor(p.opp_rank_vs_role, p.opp_rank_total);
  const mLabel = matchupLabel(p.opp_rank_vs_role, p.opp_rank_total);
  const iColor = p.injury_status ? INJURY_COLOR[p.injury_status] : null;
  const lineTxt = s.col.key === "atd" ? "scored" : `≥ ${s.floor} (his own floor)`;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={CARD.simple}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={teamLogo(p.team)} alt={p.team} className="w-6 h-6 object-contain shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-foreground truncate">{p.name}</span>
          <span className="text-[10px] font-bold shrink-0 px-1 rounded" style={{ color: posColor(p.pos), background: "rgba(255,255,255,0.06)" }}>
            {roleLabel(p.role)}
          </span>
          {iColor && p.injury_status && (
            <span className="text-[9px] font-bold shrink-0 px-1 rounded uppercase" style={{ color: iColor, background: `${iColor}1a` }}>
              {p.injury_status}
            </span>
          )}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: color.muted }}>
          {p.team} <span style={{ color: "rgba(255,255,255,0.3)" }}>vs</span> {p.opponent}
          <span className="mx-1.5">·</span>{s.col.label} {lineTxt}
          {s.col.key !== "atd" && <span className="mx-1 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>(typically {s.priorAvg.toFixed(1)})</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider w-12 text-center" style={{ color: mColor }}>{mLabel}</span>
        <div className="text-right w-14">
          <div className="text-[16px] font-bold font-mono leading-none" style={{ color: color.green }}>{s.games}/{s.games}</div>
          <div className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: color.muted }}>streak</div>
        </div>
      </div>
    </div>
  );
}

const YARD_KEYS = new Set(["rec_yds", "rush_yds", "pass_yds"]);

export function HitStreaks({ slate }: { slate: NflSlate }) {
  const [windowN, setWindowN] = useState<(typeof WINDOWS)[number]>(5);
  const streaks = useMemo(() => computeStreaks(slate, windowN), [slate, windowN]);

  const yards = useMemo(
    () => streaks.filter((s) => YARD_KEYS.has(s.col.key as string)).sort((a, b) => b.games - a.games || b.priorAvg - a.priorAvg),
    [streaks],
  );
  const atd = useMemo(
    () => streaks.filter((s) => s.col.key === "atd").sort((a, b) => b.games - a.games || b.player.score - a.player.score),
    [streaks],
  );
  const other = useMemo(
    () => streaks.filter((s) => !YARD_KEYS.has(s.col.key as string) && s.col.key !== "atd").sort((a, b) => b.games - a.games),
    [streaks],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-[-0.005em]">100% Hit-Rate Streaks</h2>
          <p className="text-[11px] mt-0.5" style={{ color: color.muted }}>
            Every game in the window cleared the player&apos;s own floor (ATD: scored every game) — not a fixed, trivial number.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindowN(w)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors"
              style={windowN === w
                ? { background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)", color: color.accent }
                : { background: "transparent", border: "1px solid #2c2c2e", color: color.muted }}
            >
              L{w}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[14px] font-semibold text-foreground mb-2">Yardage Streaks</h3>
        {yards.length === 0 ? (
          <p className="text-[12px] px-1" style={{ color: color.muted }}>No one has cleared their own yardage floor every game this window.</p>
        ) : (
          <div className="space-y-1.5">{yards.map((s) => <StreakRow key={s.player.gsis_id + s.player.team + s.col.key} s={s} />)}</div>
        )}
      </div>

      <div>
        <h3 className="text-[14px] font-semibold text-foreground mb-2">Anytime-TD Streaks</h3>
        {atd.length === 0 ? (
          <p className="text-[12px] px-1" style={{ color: color.muted }}>No one has scored every game this window.</p>
        ) : (
          <div className="space-y-1.5">{atd.map((s) => <StreakRow key={s.player.gsis_id + s.player.team + s.col.key} s={s} />)}</div>
        )}
      </div>

      <div>
        <h3 className="text-[14px] font-semibold text-foreground mb-2">Other Stat Streaks</h3>
        {other.length === 0 ? (
          <p className="text-[12px] px-1" style={{ color: color.muted }}>No other stat streaks this window.</p>
        ) : (
          <div className="space-y-1.5">{other.map((s) => <StreakRow key={s.player.gsis_id + s.player.team + s.col.key} s={s} />)}</div>
        )}
      </div>
    </div>
  );
}
