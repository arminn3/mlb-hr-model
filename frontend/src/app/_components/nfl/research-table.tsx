"use client";

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflPlayer } from "./types";
import { fmtPct, fmtPct1, scoreColor, posColor, dvpColor } from "./format";

type Col = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  get: (p: NflPlayer) => number | string;
  fmt?: (p: NflPlayer) => React.ReactNode;
  numeric?: boolean;
};

// Static class strings so Tailwind's JIT detects them (dynamic `text-${x}` is
// not scanned and would silently drop the alignment).
const ALIGN: Record<string, string> = { left: "text-left", right: "text-right", center: "text-center" };

const COLS: Col[] = [
  { key: "name", label: "Player", align: "left", get: (p) => p.name },
  { key: "pos", label: "Pos", align: "center", get: (p) => p.pos },
  { key: "team", label: "Team", align: "center", get: (p) => p.team },
  { key: "opponent", label: "Opp", align: "center", get: (p) => p.opponent },
  { key: "score", label: "TD%", align: "right", numeric: true, get: (p) => p.score },
  { key: "hit_rate_season", label: "Hit% Szn", align: "right", numeric: true, get: (p) => p.hit_rate_season },
  { key: "hit_rate_l5", label: "Hit% L5", align: "right", numeric: true, get: (p) => p.hit_rate_l5 },
  { key: "rz_opp_share", label: "RZ Opp%", align: "right", numeric: true, get: (p) => p.rz_opp_share },
  { key: "dvp_rank", label: "DvP#", align: "right", numeric: true, get: (p) => p.dvp_rank },
  { key: "snap_pct", label: "Snap%", align: "right", numeric: true, get: (p) => p.snap_pct },
  { key: "implied_team_total", label: "Imp Tot", align: "right", numeric: true, get: (p) => p.implied_team_total },
];

export function ResearchTable({
  slate,
  favorites,
  onToggleFavorite,
}: {
  slate: NflSlate;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState("score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [posFilter, setPosFilter] = useState<string>("ALL");

  const allPlayers = useMemo(() => slate.games.flatMap((g) => g.players), [slate]);
  const positions = useMemo(
    () => ["ALL", ...Array.from(new Set(allPlayers.map((p) => p.pos)))],
    [allPlayers],
  );

  const rows = useMemo(() => {
    const col = COLS.find((c) => c.key === sortKey)!;
    const filtered = posFilter === "ALL" ? allPlayers : allPlayers.filter((p) => p.pos === posFilter);
    return [...filtered].sort((a, b) => {
      const av = col.get(a), bv = col.get(b);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [allPlayers, sortKey, dir, posFilter]);

  const toggleSort = (key: string, numeric?: boolean) => {
    if (sortKey === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setDir(numeric ? "desc" : "asc"); }
  };

  const cell = (p: NflPlayer, c: Col): React.ReactNode => {
    switch (c.key) {
      case "score":
        return <span style={{ color: scoreColor(p.score), fontWeight: 700 }}>{fmtPct1(p.score)}</span>;
      case "pos":
        return <span style={{ color: posColor(p.pos), fontWeight: 600 }}>{p.pos}</span>;
      case "hit_rate_season":
      case "hit_rate_l5":
        return fmtPct(c.get(p) as number);
      case "rz_opp_share":
      case "snap_pct":
        return fmtPct(c.get(p) as number);
      case "dvp_rank":
        return <span style={{ color: dvpColor(p.dvp_rank) }}>{p.dvp_rank || "—"}</span>;
      default:
        return c.get(p);
    }
  };

  return (
    <div className="space-y-3">
      {/* position filter chips */}
      <div className="flex flex-wrap gap-2">
        {positions.map((pos) => (
          <button
            key={pos}
            onClick={() => setPosFilter(pos)}
            className="px-3 py-1 rounded-full text-[12px] font-semibold cursor-pointer transition-colors"
            style={
              posFilter === pos
                ? { background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)", color: color.accent }
                : { background: "transparent", border: "1px solid #2c2c2e", color: color.muted }
            }
          >
            {pos}
          </button>
        ))}
      </div>

      <div className="rounded-xl overflow-x-auto" style={CARD.elevated}>
        <table className="w-full min-w-[860px] text-[13px]">
          <thead style={{ background: "rgba(20,20,22,0.95)" }}>
            <tr className="text-[10px] uppercase tracking-wider" style={{ color: color.muted }}>
              <th className="py-2.5 pl-3 pr-2 text-right font-semibold">#</th>
              <th className="py-2.5 px-2 text-center font-semibold">★</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key, c.numeric)}
                  className={`py-2.5 px-2 font-semibold cursor-pointer select-none whitespace-nowrap ${ALIGN[c.align ?? "left"]} hover:text-foreground`}
                  style={sortKey === c.key ? { color: color.accent } : undefined}
                >
                  {c.label}{sortKey === c.key ? (dir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const fav = favorites.has(p.gsis_id);
              return (
                <tr key={p.gsis_id + p.team} className="border-b last:border-0" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                  <td className="py-2 pl-3 pr-2 text-right font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{i + 1}</td>
                  <td className="py-2 px-2 text-center">
                    <button onClick={() => onToggleFavorite(p.gsis_id)} className="cursor-pointer align-middle" aria-label="favorite">
                      <Star size={14} fill={fav ? color.yellow : "none"} stroke={fav ? color.yellow : "rgba(255,255,255,0.25)"} />
                    </button>
                  </td>
                  {COLS.map((c) => (
                    <td key={c.key} className={`py-2 px-2 whitespace-nowrap ${ALIGN[c.align ?? "left"]} ${c.key === "name" ? "font-semibold text-foreground" : "text-foreground/85"}`}>
                      {cell(p, c)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
