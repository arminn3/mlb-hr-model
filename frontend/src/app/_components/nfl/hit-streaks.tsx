"use client";

import { useMemo, useState } from "react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflPlayer } from "./types";
import { teamLogo, matchupColor, matchupLabel, posColor } from "./format";
import { colsFor, roundLine, roleLabel, type ColDef } from "./player-research";

// A "100%" streak means every game in the window cleared the player's OWN
// rolling average (same line convention as the Research game-log) — not a
// fixed floor. A true alpha WR1 clearing 20 receiving yards every game is
// meaningless (he'd clear that in his sleep); clearing HIS OWN ~95-yard
// average every single game, with zero off weeks, is a genuinely rare,
// noteworthy consistency streak regardless of who the player is. This also
// means a merely-good player with one so-so game drops off the list
// entirely — the bar scales with how good he already is.
const WINDOWS = [5, 10] as const;
// A "100%" streak over 1-2 games is just small-sample noise, not a real
// signal — require this many real games in the window before it counts.
const MIN_SAMPLE = 3;

type Streak = { player: NflPlayer; col: ColDef; games: number; avg: number; line: number };

function computeStreaks(slate: NflSlate, windowN: number): Streak[] {
  const out: Streak[] = [];
  for (const g of slate.games) {
    for (const p of g.players) {
      if (!p.role || !p.game_log?.length) continue;
      const sorted = [...p.game_log].sort((a, b) => a.date.localeCompare(b.date));
      const recent = sorted.slice(-windowN);
      if (recent.length < MIN_SAMPLE) continue;
      for (const col of colsFor(p.pos)) {
        const vals = recent.map((r) => Number(r[col.key] ?? 0));
        const avg = vals.reduce((s, x) => s + x, 0) / vals.length;
        const line = roundLine(avg, col.key as string);
        const hits = vals.filter((v) => (col.invert ? v < line : v > line)).length;
        if (hits === recent.length) out.push({ player: p, col, games: recent.length, avg, line });
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
  const lineTxt = s.col.key === "atd" ? "scored" : `${s.col.invert ? "under" : "over"} ${s.line}`;
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
          {s.col.key !== "atd" && <span className="mx-1 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>(avg {s.avg.toFixed(1)})</span>}
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

export function HitStreaks({ slate }: { slate: NflSlate }) {
  const [windowN, setWindowN] = useState<(typeof WINDOWS)[number]>(5);
  const streaks = useMemo(() => computeStreaks(slate, windowN), [slate, windowN]);

  const atd = useMemo(
    () => streaks.filter((s) => s.col.key === "atd").sort((a, b) => b.games - a.games || b.player.score - a.player.score),
    [streaks],
  );
  const other = useMemo(
    () => streaks.filter((s) => s.col.key !== "atd").sort((a, b) => b.games - a.games),
    [streaks],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-foreground tracking-[-0.005em]">100% Hit-Rate Streaks</h2>
          <p className="text-[11px] mt-0.5" style={{ color: color.muted }}>
            Every game in the window cleared the player&apos;s own rolling average — not a fixed, trivial floor. Min {MIN_SAMPLE} games.
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
