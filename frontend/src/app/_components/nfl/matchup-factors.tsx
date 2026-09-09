"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import type { NflGame, AtsSplits, LastGameResult } from "./types";
import { teamLogo } from "./format";
import { Toggle, sortedYears } from "./toggle";

// Same dark-card tokens as Lineups/Research (Figma node 6:1043).
const CARD_BG = "#1b1b1b";
const BORDER = "#343434";
const CELL_BORDER = "1px solid #1b1b1b";
const HEAD = "#ccc";
const HIT_GREEN = "#49e174";
const HIT_RED = "#ff6f6f";

function Card({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4 flex-1 min-w-[220px]" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[14px] font-semibold text-white">{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

const ROOF_LABEL: Record<string, string> = { outdoors: "OUTDOOR", dome: "DOME", closed: "CLOSED", open: "OPEN" };
const roofLabel = (r: string | null) => (r ? (ROOF_LABEL[r] ?? r.toUpperCase()) : "--");
const surfaceLabel = (s: string | null) => (s ? (s === "grass" ? "GRASS" : "ARTIFICIAL") : "--");

function WeatherCard({ game }: { game: NflGame }) {
  return (
    <Card title={game.stadium ? `${game.stadium} Forecast` : "Weather Forecast"}>
      <div className="text-[32px] font-semibold text-white leading-none">
        {game.weather_temp != null ? `${Math.round(game.weather_temp)}°F` : "--°F"}
      </div>
      <div className="text-[12px] mt-2" style={{ color: HEAD }}>
        Wind: {game.weather_wind != null ? `${Math.round(game.weather_wind)} mph` : "--"}
      </div>
    </Card>
  );
}

function StadiumCard({ game }: { game: NflGame }) {
  const rows: [string, string][] = [
    ["Roof", roofLabel(game.roof)],
    ["Surface", surfaceLabel(game.surface)],
  ];
  return (
    <Card title={game.stadium ?? "Stadium"}>
      <div className="flex flex-col gap-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-[12px]">
            <span style={{ color: HEAD }}>{label.toUpperCase()}:</span>
            <span className="font-semibold text-white">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const ATS_ROWS: [keyof AtsSplits, string][] = [
  ["total", "Total"], ["home", "Home"], ["away", "Away"], ["favored", "Favored"], ["underdog", "Underdog"],
];

function AtsCard({ team, atsByYear }: { team: string; atsByYear: Record<string, AtsSplits> }) {
  const years = sortedYears(Object.keys(atsByYear));
  const [year, setYear] = useState(years[0]);
  const ats = atsByYear[year] ?? atsByYear[years[0]];
  return (
    <Card
      title="ATS Record"
      icon={<img src={teamLogo(team)} alt={team} className="w-5 h-5 object-contain" />}
      right={years.length > 1 && <Toggle options={years} value={year} onChange={setYear} />}
    >
      <table className="w-full text-[12px] border-collapse">
        <tbody>
          {ATS_ROWS.map(([key, label]) => {
            const r = ats[key];
            return (
              <tr key={key}>
                <td className="py-1" style={{ color: HEAD, borderRight: CELL_BORDER }}>{label}</td>
                <td className="py-1 text-right font-semibold text-white">{r.record}</td>
                <td className="py-1 pl-2 text-right font-mono" style={{ color: r.pct == null ? HEAD : r.pct >= 0.5 ? HIT_GREEN : HIT_RED, width: 48 }}>
                  {r.pct == null ? "--" : `${Math.round(r.pct * 100)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Last5Card({ team, last5ByYear }: { team: string; last5ByYear: Record<string, LastGameResult[]> }) {
  const years = sortedYears(Object.keys(last5ByYear));
  const [year, setYear] = useState(years[0]);
  const rows = last5ByYear[year] ?? last5ByYear[years[0]] ?? [];
  return (
    <Card
      title="Last 5 Games"
      icon={<img src={teamLogo(team)} alt={team} className="w-5 h-5 object-contain" />}
      right={years.length > 1 && <Toggle options={years} value={year} onChange={setYear} />}
    >
      {rows.length === 0 ? (
        <p className="text-[12px]" style={{ color: HEAD }}>No completed games that season.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.date} className="flex items-center gap-2 text-[12px]">
              <span className="w-14 shrink-0" style={{ color: HEAD }}>{r.date.slice(5)}</span>
              <span className="flex items-center gap-1 flex-1 min-w-0">
                <span style={{ color: HEAD }}>{r.home ? "vs" : "at"}</span>
                <img src={teamLogo(r.opp)} alt={r.opp} className="w-4 h-4 object-contain shrink-0" />
                <span className="text-white truncate">{r.opp}</span>
              </span>
              <span className="font-semibold" style={{ color: r.won ? HIT_GREEN : HIT_RED }}>
                {r.won ? "W" : "L"} {r.team_score}-{r.opp_score}
              </span>
              <span className="w-10 text-right font-semibold" style={{ color: r.cover === "w" ? HIT_GREEN : r.cover === "l" ? HIT_RED : HEAD }}>
                {r.cover === "p" ? "PUSH" : r.cover.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function MatchupFactors({ game }: { game: NflGame }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[16px] font-semibold text-white">Matchup Factors</h3>
      <div className="flex flex-wrap gap-3">
        <WeatherCard game={game} />
        <StadiumCard game={game} />
        <AtsCard team={game.away_team} atsByYear={game.away_ats} />
        <AtsCard team={game.home_team} atsByYear={game.home_ats} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Last5Card team={game.away_team} last5ByYear={game.away_last5} />
        <Last5Card team={game.home_team} last5ByYear={game.home_last5} />
      </div>
    </div>
  );
}
