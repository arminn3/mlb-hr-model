"use client";

import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelData, LookbackKey, GameEnvironment } from "./types";
import { Sidebar, type Page } from "./sidebar";
import { LookbackToggle } from "./lookback-toggle";
import { DatePicker } from "./date-picker";
import { GameSection } from "./game-section";
import { EnvironmentView } from "./environment-view";
import { Methodology } from "./methodology";
import { TopPicks } from "./top-picks";
import { MLRankings } from "./ml-rankings";
import { ResultsView } from "./results-view";
import { MethodologyPage } from "./methodology-page";
import { SlipGenerator } from "./slip-generator";
import { BvPPage } from "./bvp-page";
import { Breakouts } from "./breakouts";
import { LiveFeed } from "./live-feed";
import { ProjectionsView } from "./projections-view";
import { MatchupAnalysis } from "./matchup-analysis";
import { TeamPitchMixPage } from "./team-pitch-mix-page";
import { IconButton } from "./ui/icon-button";
import { teamLogoUrl } from "./game-header";

function formatLongDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const ord = d % 100 >= 11 && d % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][d % 10] ?? "th";
  return `${month} ${d}${ord}`;
}

/** Central per-tab config. Replaces the hardcoded conditional at the
 *  old dashboard header line 209. Easier to audit which tabs show what. */
const TAB_CONFIG: Record<Page, {
  title: string;
  subtitle?: string;
  showLookback: boolean;
  showDatePicker: boolean;
}> = {
  rankings:    { title: "HR Rankings",       subtitle: "Top HR plays by composite score",      showLookback: true,  showDatePicker: true },
  ml:          { title: "ML Rankings",       subtitle: "Data-driven — learned from 125k slate samples", showLookback: true,  showDatePicker: true },
  slate:       { title: "Game Slate",        subtitle: "Every game on today's card",           showLookback: true,  showDatePicker: true },
  projections: { title: "Projections",       subtitle: "Future at-bat modeling",               showLookback: false, showDatePicker: true },
  environment: { title: "Environment",       subtitle: "Park, weather, and wind conditions",   showLookback: false, showDatePicker: true },
  slips:       { title: "Slip Generator",    subtitle: "Build multi-leg parlays",              showLookback: true,  showDatePicker: true },
  bvp:         { title: "Batter vs Pitcher", subtitle: "Head-to-head history",                 showLookback: true,  showDatePicker: true },
  team_pitch_mix: { title: "Team vs Pitch Mix", subtitle: "Lineup stats vs opposing pitcher's arsenal", showLookback: false, showDatePicker: true },
  breakouts:   { title: "Breakouts & Regression", subtitle: "Over- and under-performers vs xHR from bat-tracking stats", showLookback: false, showDatePicker: false },
  live:        { title: "Live Feed",         subtitle: "Real-time + historical game action",   showLookback: false, showDatePicker: true },
  results:     { title: "Results Log",       subtitle: "How the model performed",              showLookback: false, showDatePicker: true },
  methodology: { title: "How It Works",      showLookback: false, showDatePicker: false },
  matchup:     { title: "Matchup Analysis",  subtitle: "Season-long hitter vs pitcher",        showLookback: false, showDatePicker: true },
};

// When MAINTENANCE_MODE_PROD is true, show the error page ONLY on
// the production Vercel deployment. Local dev (`npm run dev`) and
// preview deploys are unaffected. Vercel auto-sets
// NEXT_PUBLIC_VERCEL_ENV to "production" / "preview" / undefined.
const MAINTENANCE_MODE_PROD = false;
const IS_PROD =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
const MAINTENANCE_MODE = MAINTENANCE_MODE_PROD && IS_PROD;

// Dates hidden from prod only (dev sees them normally).
// Add YYYY-MM-DD strings here to fall back to the prior day on prod.
const PROD_BLOCKED_DATES: Set<string> = new Set(
  IS_PROD ? ["2026-04-28"] : []
);

function MaintenancePage({ onLive }: { onLive: () => void }) {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="bg-card/50 border border-card-border rounded-xl p-8 max-w-md text-center">
        <div className="mb-4">
          <svg className="w-12 h-12 mx-auto text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        </div>
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted mb-1">
          Error 503
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Service Temporarily Unavailable
        </h2>
        <p className="text-sm text-muted mb-5">
          We&apos;re experiencing technical difficulties. Please check back shortly.
        </p>
        <button
          onClick={onLive}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-accent text-background hover:bg-accent/90 cursor-pointer transition-colors"
        >
          View Live Game Feed
        </button>
      </div>
    </div>
  );
}

type SlateGame = { game_pk: number; away_team: string; home_team: string; game_time?: string };

function SlateGameFilter({
  games,
  date,
  selected,
  onSelect,
}: {
  games: SlateGame[];
  date: string;
  selected: Set<number>;
  onSelect: (gamePk: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const longDate = formatLongDate(date);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScrollState();
    const ro = new ResizeObserver(updateScrollState);
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [games.length]);

  const page = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="relative mb-6">
      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="flex gap-3 overflow-x-auto pb-1 px-1 scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {games.map((game) => {
          const sel = selected.has(game.game_pk);
          const time = (game.game_time ?? "").replace(/\s*ET\s*$/i, "").trim();
          return (
            <button
              key={game.game_pk}
              type="button"
              onClick={() => onSelect(game.game_pk)}
              className={`shrink-0 w-[160px] rounded-2xl px-4 py-3 cursor-pointer transition-all flex flex-col gap-3 items-stretch ${
                sel
                  ? "bg-accent/10 border border-accent shadow-[0_0_0_1px_var(--accent)]"
                  : "bg-card/50 border border-card-border hover:border-foreground/40"
              }`}
            >
              <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center w-full">
                <div className="flex gap-1 items-center justify-self-end">
                  <img
                    src={teamLogoUrl(game.away_team)}
                    alt={game.away_team}
                    className="w-4 h-4 object-contain"
                    loading="lazy"
                  />
                  <span className="text-sm font-medium text-foreground">{game.away_team}</span>
                </div>
                <span className="text-xs text-muted">@</span>
                <div className="flex gap-1 items-center justify-self-start">
                  <img
                    src={teamLogoUrl(game.home_team)}
                    alt={game.home_team}
                    className="w-4 h-4 object-contain"
                    loading="lazy"
                  />
                  <span className="text-sm font-medium text-foreground">{game.home_team}</span>
                </div>
              </div>
              <div className="text-center text-xs text-muted whitespace-nowrap">
                {longDate}
                {time && <span className="text-[9px] mx-1 align-middle">•</span>}
                {time && time}
              </div>
            </button>
          );
        })}
      </div>

      {/* Left edge: fade + chevron, only when scrollable left */}
      <div
        aria-hidden
        className={`pointer-events-none absolute left-0 top-0 bottom-2 w-16 bg-gradient-to-r from-background to-transparent transition-opacity duration-200 ${
          canScrollLeft ? "opacity-100" : "opacity-0"
        }`}
      />
      <button
        type="button"
        aria-label="Scroll games left"
        onClick={() => page(-1)}
        className={`absolute left-0 top-1/2 -translate-y-1/2 size-9 flex items-center justify-center rounded-lg bg-card border border-card-border text-muted hover:text-foreground hover:border-foreground/40 cursor-pointer shadow-sm transition-opacity duration-200 ${
          canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <ChevronLeft className="size-4" />
      </button>

      {/* Right edge: fade + chevron, only when scrollable right */}
      <div
        aria-hidden
        className={`pointer-events-none absolute right-0 top-0 bottom-2 w-16 bg-gradient-to-l from-background to-transparent transition-opacity duration-200 ${
          canScrollRight ? "opacity-100" : "opacity-0"
        }`}
      />
      <button
        type="button"
        aria-label="Scroll games right"
        onClick={() => page(1)}
        className={`absolute right-0 top-1/2 -translate-y-1/2 size-9 flex items-center justify-center rounded-lg bg-card border border-card-border text-muted hover:text-foreground hover:border-foreground/40 cursor-pointer shadow-sm transition-opacity duration-200 ${
          canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<ModelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("beeb:sidebar-collapsed") === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("beeb:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  // Read initial state from URL hash: #page=rankings&date=2026-04-03&lookback=L5
  function getHashParam(key: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    return params.get(key) || fallback;
  }

  const [activePage, setActivePageRaw] = useState<Page>(() => getHashParam("page", "rankings") as Page);
  const [lookback, setLookbackRaw] = useState<LookbackKey>(() => getHashParam("lookback", "L5") as LookbackKey);
  const [selectedDate, setSelectedDate] = useState<string>(() => getHashParam("date", ""));
  const [selectedGames, setSelectedGames] = useState<Set<number>>(new Set()); // empty = all games

  // Update URL hash when state changes
  function updateHash(page: string, date: string, lb: string) {
    if (typeof window === "undefined") return;
    window.location.hash = `page=${page}&date=${date}&lookback=${lb}`;
  }

  const setActivePage = (p: Page) => {
    setActivePageRaw(p);
    updateHash(p, selectedDate, lookback);
  };
  const setLookback = (lb: LookbackKey) => {
    setLookbackRaw(lb);
    updateHash(activePage, selectedDate, lb);
  };

  const loadDate = (dateStr: string) => {
    const url = dateStr ? `/data/${dateStr}.json` : "/data/latest.json";
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("No data for this date.");
        return res.json();
      })
      .then(async (d: ModelData) => {
        // If the fetched date is blocked on prod, walk back day by day
        // until we land on an unblocked date.
        let cur = d;
        let safety = 14;
        while (PROD_BLOCKED_DATES.has(cur.date) && safety-- > 0) {
          const [y, m, day] = cur.date.split("-").map(Number);
          const prev = new Date(Date.UTC(y, m - 1, day - 1));
          const prevStr = prev.toISOString().slice(0, 10);
          const resp = await fetch(`/data/${prevStr}.json`);
          if (!resp.ok) break;
          cur = await resp.json();
        }
        return cur;
      })
      .then((d: ModelData) => {
        setData(d);
        setSelectedDate(d.date);
        updateHash(activePage, d.date, lookback);
        setError(null);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    // Always load latest data on first visit
    loadDate("");
  }, []);

  // Default the slate filter to the first game whenever the date changes.
  useEffect(() => {
    if (!data?.games || data.games.length === 0) return;
    setSelectedGames(new Set([data.games[0].game_pk]));
  }, [data?.date]);

  // Maintenance gate — runs after all hooks are declared so hook order
  // stays stable across re-renders. Live Feed stays reachable on prod.
  if (MAINTENANCE_MODE && activePage !== "live") {
    return <MaintenancePage onLive={() => setActivePage("live")} />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="bg-card/50 border border-card-border rounded-xl p-8 max-w-md text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">No Model Data Yet</h2>
          <p className="text-sm text-muted mb-4">{error}</p>
          <code className="text-xs bg-background px-3 py-2 rounded text-accent font-mono block">
            python main.py
          </code>
        </div>
      </div>
    );
  }

  if (!data) {
    return <DashboardSkeleton />;
  }

  const totalPlayers = data.games.reduce((sum, g) => sum + g.players.length, 0);

  const envGames: Array<{
    game_pk: number;
    away_team: string;
    home_team: string;
    away_pitcher: string;
    home_pitcher: string;
  } & GameEnvironment> = data.games.map((g) => ({
    game_pk: g.game_pk,
    away_team: g.away_team,
    home_team: g.home_team,
    away_pitcher: g.away_pitcher.name,
    home_pitcher: g.home_pitcher.name,
    ...g.environment,
  }));

  const handlePageChange = (page: Page) => {
    setActivePage(page);
    setSidebarOpen(false); // close on mobile after selecting
  };

  const tabConfig = TAB_CONFIG[activePage];

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — slide-in drawer on mobile, icon-strip collapse on desktop */}
      <div
        className={
          "fixed lg:static z-40 " +
          "transition-transform duration-[var(--duration-base)] " +
          (sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0")
        }
      >
        <Sidebar
          active={activePage}
          collapsed={sidebarCollapsed}
          onChange={handlePageChange}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — 3 slots: left (title/meta), center (date), right (lookback)
            Mobile: stacks — title row above, controls row below. */}
        <header
          className="sticky top-0 z-10 backdrop-blur-md px-4 md:px-8 flex items-center"
          style={{ height: 60, background: "#1c1c1e", borderBottom: "1px solid #2c2c2e" }}
        >
          <div className="w-full flex items-center justify-between gap-3">
            {/* LEFT slot */}
            <div className="flex items-center gap-3 min-w-0">
              <IconButton
                icon={Menu}
                aria-label="Open navigation"
                variant="ghost"
                size="md"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden"
              />
              <div className="min-w-0">
                <h1 className="text-[14px] leading-[20px] font-semibold tracking-[-0.005em] text-foreground truncate">
                  {tabConfig.title}
                </h1>
                <p className="text-[11px] leading-[14px] font-medium tracking-[0.02em] text-muted truncate">
                  {tabConfig.subtitle ?? `${totalPlayers} players \u00b7 ${data.games.length} games`}
                </p>
              </div>
            </div>

            {/* RIGHT slot (date + lookback) */}
            <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
              {tabConfig.showLookback && (
                <LookbackToggle value={lookback} onChange={setLookback} />
              )}
              {tabConfig.showDatePicker && (
                <DatePicker currentDate={selectedDate} onChange={loadDate} />
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-8">
          {activePage === "ml" && (
            <MLRankings games={data.games} lookback={lookback} currentDate={data.date} />
          )}

          {activePage === "rankings" && (
            <TopPicks games={data.games} lookback={lookback} />
          )}

          {activePage === "slate" && (
            <>
              <SlateGameFilter
                games={data.games}
                date={data.date}
                selected={selectedGames}
                onSelect={(pk) => setSelectedGames(new Set([pk]))}
              />
              {data.games.filter((g) => selectedGames.has(g.game_pk)).map((game) => (
                <GameSection key={game.game_pk} game={game} lookback={lookback} />
              ))}
              {data.games.length === 0 && (
                <p className="text-center text-muted py-12">No games with scored players today.</p>
              )}
            </>
          )}

          {activePage === "projections" && (
            <ProjectionsView games={data.games} lookback={lookback} />
          )}

          {activePage === "environment" && (
            <EnvironmentView games={envGames} />
          )}

          {activePage === "live" && (
            // Don't pass the dashboard's selectedDate — on prod it gets
            // walked back to the prior unblocked slate, which would force
            // LiveFeed into past-date mode and break today's live polling.
            // LiveFeed has its own internal date state + Yesterday button.
            <LiveFeed />
          )}

          {activePage === "bvp" && (
            <BvPPage games={data.games} lookback={lookback} />
          )}

          {activePage === "team_pitch_mix" && (
            <TeamPitchMixPage games={data.games} />
          )}

          {activePage === "breakouts" && (
            <Breakouts games={data.games} />
          )}

          {activePage === "matchup" && (
            <MatchupAnalysis games={data.games} />
          )}

          {activePage === "slips" && (
            <SlipGenerator games={data.games} lookback={lookback} />
          )}

          {activePage === "results" && (
            <ResultsView selectedDate={selectedDate} />
          )}

          {activePage === "methodology" && (
            <MethodologyPage />
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------- Loading skeleton ---------- */

function SkelBlock({ className = "" }: { className?: string }) {
  return <div className={`bg-white/5 rounded animate-pulse ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar skeleton */}
      <aside className="hidden lg:flex w-56 flex-col gap-2 border-r border-card-border bg-card/20 p-4">
        <SkelBlock className="h-8 w-32 mb-4" />
        {Array.from({ length: 8 }).map((_, i) => (
          <SkelBlock key={i} className="h-8 w-full" />
        ))}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar skeleton */}
        <header className="sticky top-0 bg-background/80 backdrop-blur-sm border-b border-card-border px-4 md:px-8 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <SkelBlock className="h-5 w-32" />
            <SkelBlock className="h-3 w-40 hidden sm:block" />
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <SkelBlock className="h-8 w-24 rounded-lg" />
            <SkelBlock className="h-8 w-32 rounded-lg" />
          </div>
        </header>

        {/* Content skeleton — 3 game-card-shaped blocks with table rows inside */}
        <main className="flex-1 p-4 md:p-8 space-y-6">
          {/* Filter chip row */}
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkelBlock key={i} className="h-7 w-20 rounded-full" />
            ))}
          </div>

          {/* Game card skeletons */}
          {Array.from({ length: 3 }).map((_, gi) => (
            <div
              key={gi}
              className="border border-card-border rounded-xl bg-card/20 p-4 md:p-6 space-y-3"
            >
              <div className="flex items-center justify-between gap-4">
                <SkelBlock className="h-5 w-48" />
                <SkelBlock className="h-4 w-24" />
              </div>
              <div className="space-y-2 pt-2">
                {Array.from({ length: 6 }).map((__, ri) => (
                  <div key={ri} className="flex items-center gap-3">
                    <SkelBlock className="h-4 w-32" />
                    <SkelBlock className="h-4 flex-1" />
                    <SkelBlock className="h-4 w-12" />
                    <SkelBlock className="h-4 w-12" />
                    <SkelBlock className="h-4 w-12" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}
