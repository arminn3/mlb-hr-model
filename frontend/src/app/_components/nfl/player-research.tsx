"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import { ChevronDown, User } from "lucide-react";
import type { NflPlayer, GameLogRow } from "./types";
import { teamLogo, playerHeadshot, teamCity, tileHeat } from "./format";

type ColDef = { key: keyof GameLogRow; label: string; invert?: boolean };

// Position-adaptive columns (full labels exactly per Figma; 12px text). INT is lower-is-better.
const QB_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "pass_att", label: "Pass Att" }, { key: "cmp", label: "Pass Comp" },
  { key: "pass_yds", label: "Pass Yards" }, { key: "pass_td", label: "Pass TD" }, { key: "pass_int", label: "Pass INT", invert: true },
  { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yards" },
];
const RB_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yards" }, { key: "rush_td", label: "Rush TD" },
  { key: "targets", label: "Tgt" }, { key: "rec", label: "Rec" }, { key: "rec_yds", label: "Rec Yards" }, { key: "rec_td", label: "Rec TD" },
];
const REC_COLS: ColDef[] = [
  { key: "atd", label: "ATD" }, { key: "targets", label: "Tgt" }, { key: "rec", label: "Rec" }, { key: "rec_yds", label: "Rec Yards" }, { key: "rec_td", label: "Rec TD" },
  { key: "rush_att", label: "Rush Att" }, { key: "rush_yds", label: "Rush Yards" },
];
const colsFor = (pos: string): ColDef[] => (pos === "QB" ? QB_COLS : pos === "RB" || pos === "FB" ? RB_COLS : REC_COLS);

// The two volume stats each position gets a threshold filter for.
const VOL_FILTERS: Record<string, { key: keyof GameLogRow; label: string }[]> = {
  QB: [{ key: "pass_att", label: "Pass Att" }, { key: "rush_att", label: "Rush Att" }],
  RB: [{ key: "rush_att", label: "Rush Att" }, { key: "targets", label: "Targets" }],
  FB: [{ key: "rush_att", label: "Rush Att" }, { key: "targets", label: "Targets" }],
  WR: [{ key: "targets", label: "Targets" }, { key: "rush_att", label: "Rush Att" }],
  TE: [{ key: "targets", label: "Targets" }, { key: "rush_att", label: "Rush Att" }],
};
const volFor = (pos: string) => VOL_FILTERS[pos] ?? VOL_FILTERS.WR;
const THRESHOLDS = [0, 5, 10, 15, 20, 25, 30];

// Design tokens (Figma node 6:1043).
const HIT_GREEN = "#49e174";
const HIT_RED = "#ff6f6f";
const CARD_BG = "#1b1b1b";
const BORDER = "#343434";
// Cell separator = a gap in the card background so each colored cell reads as its own tile.
const CELL_BORDER = "1px solid #1b1b1b";
const HEAD = "#ccc";
// frozen lead columns while the stat columns scroll horizontally
const FREEZE_SHADOW = "8px 0 10px -6px rgba(0,0,0,0.6)"; // frozen-column edge shadow (modern scroll look)
const STICKY1: React.CSSProperties = { position: "sticky", left: 0, zIndex: 2, background: CARD_BG, boxShadow: FREEZE_SHADOW };
const STICKY2: React.CSSProperties = { position: "sticky", left: 76, zIndex: 2, background: CARD_BG, boxShadow: FREEZE_SHADOW };
const BLOCK = { background: CARD_BG, border: `1px solid ${BORDER}` }; // header only
const PANEL = { background: CARD_BG };                                 // table / avg / hit (no border)

// Figma per-column widths (node 6:1075) scaled ~0.85 for 12px text.
const COL_W: Record<string, number> = {
  atd: 46, pass_att: 70, cmp: 86, pass_yds: 85, pass_td: 69, pass_int: 72,
  rush_att: 71, rush_yds: 85, rush_td: 69, targets: 54, rec: 54, rec_yds: 85, rec_td: 69,
};

const roundLine = (v: number, key: string) => (key === "atd" ? 0.5 : Math.round(v * 2) / 2);

// Depth role incl. position + slot. Model uses a single "QB" tier -> show "QB1".
const roleLabel = (role: string) => (role === "QB" ? "QB1" : role);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso: string) => { const p = iso.split("-"); return p.length === 3 ? `${MON[+p[1] - 1]} ${+p[2]}` : iso; };
// NFL season year: Jan/Feb games (playoffs) belong to the prior season.
const seasonOf = (iso: string) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return m >= 3 ? y : y - 1; };

// Placeholder sportsbook glyph (a specific book's logo slots in when live odds wire in).
function BookMark() {
  return <span className="inline-block w-[9px] h-[11px] rounded-[2px] shrink-0" style={{ background: "#6b7280" }} />;
}

// Defense-card role-holder: at/vs + team logo + headshot (name on hover), compact.
function RoleHolder({ r }: { r: GameLogRow }) {
  const src = r.headshot || playerHeadshot(r.espn_id);
  const nm = r.name ?? "";
  return (
    <span className="inline-flex items-center gap-1" title={nm}>
      <span className="text-[11px]" style={{ color: HEAD }}>{r.home ? "vs" : "at"}</span>
      {r.team && <img src={teamLogo(r.team)} alt={r.team} className="w-4 h-4 object-contain shrink-0" />}
      {src
        ? <img src={src} alt={nm} className="w-6 h-6 rounded-full object-cover object-top shrink-0" style={{ background: "#333" }} />
        : <span className="w-6 h-6 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: "#333" }}><User size={13} className="text-white/55" /></span>}
    </span>
  );
}

// A toggle filter chip (design row-1 style).
function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 whitespace-nowrap font-semibold text-white px-2 py-2 rounded-lg text-[14px] cursor-pointer transition-colors"
      style={active ? { background: "#1e2444", border: "1px solid #3a54d5" } : { background: "#333", color: HEAD }}
    >
      {children}
    </button>
  );
}

// A dropdown-style pill wrapping a native <select> (design row-2 style).
function SelectChip({ label, value, options, fmt, onChange }: {
  label: string; value: number; options: number[]; fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  const active = value > 0;
  return (
    <label
      className="relative inline-flex items-center gap-1 whitespace-nowrap font-medium px-2 py-1 rounded-full text-[14px] cursor-pointer"
      style={active ? { background: "#1e2444", border: "1px solid #3a54d5", color: "#fff" } : { background: "#333", color: HEAD }}
    >
      {label}: {fmt(value)}
      <ChevronDown size={16} style={{ color: active ? "#fff" : HEAD }} />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {options.map((o) => <option key={o} value={o}>{fmt(o)}</option>)}
      </select>
    </label>
  );
}

// "Without Players" dropdown — pick a key player to see games recorded while they were out.
function WithoutChip({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const active = value !== "";
  return (
    <label
      className="relative inline-flex items-center gap-1 whitespace-nowrap font-medium px-2 py-1 rounded-full text-[14px] cursor-pointer"
      style={active ? { background: "#1e2444", border: "1px solid #3a54d5", color: "#fff" } : { background: "#333", color: HEAD }}
    >
      {active ? `w/o ${value}` : "Without Players"}
      <ChevronDown size={16} style={{ color: active ? "#fff" : HEAD }} />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
        <option value="">Without Players</option>
        {options.map((o) => <option key={o} value={o}>{`Without ${o}`}</option>)}
      </select>
    </label>
  );
}

function LineTable({ header, rows, cols, pos, opponent, offense, without = [], showName, showOpp = true, currentSeason }: {
  header: React.ReactNode; rows: GameLogRow[]; cols: ColDef[];
  pos: string; opponent: string; offense: boolean; without?: string[]; showName?: boolean; showOpp?: boolean; currentSeason: number;
}) {
  const [loc, setLoc] = useState<"all" | "home" | "away">("all");
  const [h2h, setH2h] = useState(false);
  const vol = volFor(pos);
  const [minA, setMinA] = useState(0);
  const [minB, setMinB] = useState(0);
  const [woPlayer, setWoPlayer] = useState("");

  // Data seasons come from the game log; the dropdown also always offers the
  // slate's own season (e.g. 2026) even before any games exist for it yet —
  // it just shows "No games match these filters" until real games are played.
  const dataSeasons = useMemo(() => [...new Set(rows.map((r) => seasonOf(r.date)))].sort((a, b) => b - a), [rows]);
  const seasons = useMemo(() => [...new Set([currentSeason, ...dataSeasons])].sort((a, b) => b - a), [dataSeasons, currentSeason]);
  const [season, setSeason] = useState<number | null>(null);
  const activeSeason = season ?? dataSeasons[0] ?? currentSeason;

  const frows = useMemo(() => rows.filter((r) =>
    (activeSeason == null || seasonOf(r.date) === activeSeason) &&
    (loc === "all" || (loc === "home" ? r.home : !r.home)) &&
    (!h2h || r.opp === opponent) &&
    (!woPlayer || (r.out ?? []).includes(woPlayer)) &&
    Number(r[vol[0].key] ?? 0) >= minA &&
    Number(r[vol[1].key] ?? 0) >= minB
  ), [rows, activeSeason, loc, h2h, woPlayer, minA, minB, opponent, vol]);

  const { avg, line } = useMemo(() => {
    const avg: Record<string, number> = {}, line: Record<string, number> = {};
    for (const c of cols) {
      const vals = frows.map((r) => Number(r[c.key] ?? 0));
      const a = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 0;
      avg[c.key as string] = a;
      line[c.key as string] = roundLine(a, c.key as string);
    }
    return { avg, line };
  }, [frows, cols]);

  const heat = (v: number, c: ColDef): string => tileHeat(v, line[c.key as string], c.invert);
  const hitStats = (c: ColDef) => {
    if (!frows.length) return null;
    const L = line[c.key as string];
    const n = frows.filter((r) => { const v = Number(r[c.key] ?? 0); return c.invert ? v < L : v > L; }).length;
    return { pct: Math.round((n / frows.length) * 100), n, total: frows.length };
  };

  const leadSpan = 1 + (showName ? 1 : 0) + (showOpp ? 1 : 0);
  const thr = (v: number) => (v === 0 ? "Any" : `${v}+`);
  // natural table width (lead cols + stat cols) — drives the per-card horizontal scroll
  const tableW = 76 + (showName ? 84 : 0) + (showOpp ? 79 : 0) + cols.reduce((s, c) => s + (COL_W[c.key as string] ?? 60), 0);

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {header}

      {/* filters — functional, sit on the page background */}
      <div className="flex flex-col gap-3 p-2">
        <div className="flex flex-wrap gap-2.5 items-center">
          <label className="relative inline-flex items-center gap-2 font-semibold text-white px-2 py-2 rounded-lg text-[14px] cursor-pointer" style={{ background: "#1e2444", border: "1px solid #3a54d5" }}>
            {"'" + String(activeSeason ?? "").slice(2)}
            <ChevronDown size={14} className="text-white/80" />
            <select value={activeSeason ?? ""} onChange={(e) => setSeason(Number(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
              {seasons.map((y) => <option key={y} value={y}>{"'" + String(y).slice(2)}</option>)}
            </select>
          </label>
          {offense && <ToggleChip active={h2h} onClick={() => setH2h((v) => !v)}>vs {teamCity(opponent)}</ToggleChip>}
          <ToggleChip active={loc === "home"} onClick={() => setLoc((v) => (v === "home" ? "all" : "home"))}>Home</ToggleChip>
          <ToggleChip active={loc === "away"} onClick={() => setLoc((v) => (v === "away" ? "all" : "away"))}>Away</ToggleChip>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          {without.length > 0 && <WithoutChip value={woPlayer} options={without} onChange={setWoPlayer} />}
          <SelectChip label={vol[0].label} value={minA} options={THRESHOLDS} fmt={thr} onChange={setMinA} />
          <SelectChip label={vol[1].label} value={minB} options={THRESHOLDS} fmt={thr} onChange={setMinB} />
        </div>
      </div>

      {/* tables scroll horizontally within the card so both cards fit on the page */}
      <div className="overflow-x-auto scroll-subtle flex-1 min-w-0">
        <div className="flex flex-col gap-2 h-full" style={{ minWidth: tableW }}>
      {/* game log — grows to fill so the AVG/HIT/Best-lines footer aligns across both cards.
          No overflow-hidden here: it would break the sticky (frozen) lead columns. */}
      <div className="flex-1" style={PANEL}>
        <table className="w-full table-fixed border-collapse text-[12px]">
          <Cols showName={showName} showOpp={showOpp} cols={cols} />
          <thead>
            <tr className="font-semibold" style={{ color: HEAD }}>
              <th className="text-left px-3 py-1.5 whitespace-nowrap" style={{ ...STICKY1, zIndex: 3, border: CELL_BORDER }}>Date</th>
              {showName && <th className="text-left px-3 py-1.5 whitespace-nowrap" style={{ ...STICKY2, zIndex: 3, border: CELL_BORDER }}>Player</th>}
              {showOpp && <th className="text-left px-3 py-1.5 whitespace-nowrap" style={{ ...STICKY2, zIndex: 3, border: CELL_BORDER }}>Opponent</th>}
              {cols.map((c, i) => (
                <th key={c.key} className="text-left px-3 py-1.5 whitespace-nowrap" style={{ border: CELL_BORDER }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-medium text-white">
            {frows.length === 0 && (
              <tr><td colSpan={cols.length + leadSpan} className="px-3 py-6 text-center" style={{ color: HEAD }}>No games match these filters.</td></tr>
            )}
            {frows.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-2 whitespace-nowrap" style={{ ...STICKY1, border: CELL_BORDER }}>{fmtDate(r.date)}</td>
                {showName && <td className="px-3 py-2" style={{ ...STICKY2, border: CELL_BORDER }}><RoleHolder r={r} /></td>}
                {showOpp && (
                  <td className="px-3 py-2 whitespace-nowrap" style={{ ...STICKY2, border: CELL_BORDER }}>
                    <span className="inline-flex items-center gap-1">vs <img src={teamLogo(r.opp)} alt={r.opp} className="w-[17px] h-[17px] object-contain" /> {r.opp}</span>
                  </td>
                )}
                {cols.map((c, ci) => {
                  const v = Number(r[c.key] ?? 0);
                  return <td key={c.key} className="px-3 py-2 whitespace-nowrap text-white" style={{ background: heat(v, c), borderRight: ci < cols.length - 1 ? CELL_BORDER : undefined }}>{v}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* AVG + HIT RATE — separate square strips */}
      {frows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div style={PANEL}>
            <table className="w-full table-fixed border-collapse text-[12px] font-semibold" style={{ color: HEAD }}>
              <Cols showName={showName} showOpp={showOpp} cols={cols} />
              <tbody><tr>
                <td colSpan={leadSpan} className="px-3 py-1.5 text-left" style={{ ...STICKY1, border: CELL_BORDER }}>AVG</td>
                {cols.map((c, i) => (
                  <td key={c.key} className="px-3 py-1.5 text-left text-white" style={{ background: heat(avg[c.key as string], c), border: CELL_BORDER }}>{avg[c.key as string].toFixed(1)}</td>
                ))}
              </tr></tbody>
            </table>
          </div>
          <div style={PANEL}>
            <table className="w-full table-fixed border-collapse text-[12px] font-semibold" style={{ color: HEAD }}>
              <Cols showName={showName} showOpp={showOpp} cols={cols} />
              <tbody><tr>
                <td colSpan={leadSpan} className="px-3 py-1.5 text-left align-middle" style={{ ...STICKY1, border: CELL_BORDER }}>HIT RATE</td>
                {cols.map((c, i) => {
                  const h = hitStats(c);
                  const col = h == null ? HEAD : h.pct >= 50 ? HIT_GREEN : HIT_RED;
                  return (
                    <td key={c.key} className="px-3 py-1.5 text-left" style={{ border: CELL_BORDER }}>
                      <div className="flex flex-col leading-tight">
                        <span style={{ color: col }}>{h == null ? "—" : `${h.pct}%`}</span>
                        {h != null && <span className="text-[10px] font-medium" style={{ color: HEAD, opacity: 0.7 }}>{h.n}/{h.total}</span>}
                      </div>
                    </td>
                  );
                })}
              </tr></tbody>
            </table>
          </div>

          {/* Best lines — line on top, over/under odds per book. Odds are placeholders until live book lines wire in-season (no fabricated odds). */}
          <div style={PANEL}>
              <table className="w-full table-fixed border-collapse text-[12px]">
                <Cols showName={showName} showOpp={showOpp} cols={cols} />
                <tbody><tr>
                  <td colSpan={leadSpan} className="px-3 py-1.5 align-middle" style={{ ...STICKY1, border: CELL_BORDER }}>
                    <button type="button" className="inline-flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] font-semibold text-white leading-tight cursor-pointer" style={{ background: "#1b2340", border: "1px solid #3a54d5", minWidth: 96 }}>
                      <span className="text-left">Best<br />lines</span>
                      <ChevronDown size={14} className="text-white/80" />
                    </button>
                  </td>
                  {cols.map((c, i) => (
                    <td key={c.key} className="px-3 py-1.5 align-top" style={{ border: CELL_BORDER }}>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-bold text-white">{line[c.key as string]}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: HEAD }}><BookMark /> —</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: HEAD }}><BookMark /> —</span>
                      </div>
                    </td>
                  ))}
                </tr></tbody>
              </table>
            </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

// Shared column sizing so the table + AVG/HIT strips line up exactly.
function Cols({ showName, showOpp, cols }: { showName?: boolean; showOpp?: boolean; cols: ColDef[] }) {
  return (
    <colgroup>
      <col style={{ width: 76 }} />
      {showName && <col style={{ width: 84 }} />}
      {showOpp && <col style={{ width: 79 }} />}
      {cols.map((c) => <col key={c.key} style={{ width: COL_W[c.key as string] }} />)}
    </colgroup>
  );
}

export function PlayerBlock({ player, currentSeason }: { player: NflPlayer; currentSeason: number }) {
  const cols = colsFor(player.pos);
  const head = player.headshot || playerHeadshot(player.espn_id);

  const offHeader = (
    <div className="flex gap-[18px] items-center p-2 rounded-t-2xl" style={BLOCK}>
      {head
        ? <img src={head} alt={player.name} className="w-16 h-16 rounded-lg object-cover object-top shrink-0" />
        : <div className="w-16 h-16 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "#2a2a2a" }}><User size={28} className="text-white/40" /></div>}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <p className="text-[20px] font-medium text-white truncate">{player.name}</p>
        <div className="flex items-center gap-4">
          <span className="px-2 py-1 rounded text-[12px] font-medium text-white" style={{ background: "rgba(58,84,213,0.5)" }}>{player.team}</span>
          <span className="text-[12px] font-semibold text-white">{roleLabel(player.role)}</span>
        </div>
      </div>
    </div>
  );

  const defHeader = (
    <div className="flex gap-[18px] items-center p-2 rounded-t-2xl" style={BLOCK}>
      <div className="w-16 h-16 flex items-center justify-center shrink-0">
        <img src={teamLogo(player.opponent)} alt={player.opponent} className="w-14 h-14 object-contain" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <p className="text-[20px] font-medium text-white truncate">{player.opponent} vs {player.role}s</p>
        <div className="flex items-center gap-4">
          <span className="px-2 py-1 rounded text-[12px] font-medium text-white" style={{ background: "rgba(58,84,213,0.5)" }}>#{player.opp_rank_vs_role}/{player.opp_rank_total}</span>
          <span className="text-[12px] font-semibold" style={{ color: HEAD }}>vs {player.role} allowed</span>
        </div>
      </div>
    </div>
  );

  // OFFENSE left, DEFENSE right. Defense drops the Opponent column (every row is vs this defense).
  return (
    <div className="grid grid-cols-2 gap-3 items-stretch">
      <LineTable header={offHeader} rows={player.game_log} cols={cols} pos={player.pos} opponent={player.opponent} offense without={player.key_teammates ?? []} currentSeason={currentSeason} />
      <LineTable header={defHeader} rows={player.role_vs_def_log} cols={cols} pos={player.pos} opponent={player.opponent} offense={false} without={player.key_defenders ?? []} showName showOpp={false} currentSeason={currentSeason} />
    </div>
  );
}
