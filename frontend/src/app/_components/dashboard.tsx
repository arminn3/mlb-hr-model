"use client";

import { ChevronLeft, ChevronRight, Menu, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelData, GameEnvironment } from "./types";
import type { UILookback } from "./score-utils";
import { Sidebar, type Page } from "./sidebar";
import { LookbackToggle } from "./lookback-toggle";
import { DatePicker } from "./date-picker";
import { GameSection, type SelectedBatter } from "./game-section";
import { BatterDetailPage } from "./batter-detail-page";
import { EnvironmentView } from "./environment-view";
import { Methodology } from "./methodology";
import { MLRankings } from "./ml-rankings";
import { MethodologyPage } from "./methodology-page";
import { SlipGenerator } from "./slip-generator";
import { FavoritesPage } from "./favorites-page";
import { BatterFilterPage } from "./batter-filter-page";
import { DEFAULT_CRITERIA, type FilterCriteria } from "./batter-filter-bar";
import { BvPPage } from "./bvp-page";
import { Breakouts } from "./breakouts";
import { LiveFeed } from "./live-feed";
import { ProjectionsView } from "./projections-view";
import { UserMenu } from "./user-menu";
import { MatchupAnalysis } from "./matchup-analysis";
import { HRDueList } from "./hr-due-list";
import { toast } from "sonner";
import { TeamPitchMixPage } from "./team-pitch-mix-page";
import { PitcherSummaryPage } from "./pitcher-summary-page";
import { IconButton } from "./ui/icon-button";
import { RefreshLineupsButton } from "./refresh-lineups-button";
import type { LineupOverride } from "./lineup-refresh";
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
  favorites:   { title: "Favorites",         subtitle: "Your starred batters for this slate",  showLookback: false, showDatePicker: true },
  batter_filter: { title: "Batter Filter",   subtitle: "Screen every batter by HR criteria",   showLookback: false, showDatePicker: true },
  ml:          { title: "Rankings",           subtitle: "",                                              showLookback: true,  showDatePicker: true },
  slate:       { title: "Game Slate",        subtitle: "Every game on today's card",           showLookback: true,  showDatePicker: true },
  hr_due:      { title: "HR Due List",       subtitle: "Players with 3+ power signals today",  showLookback: true,  showDatePicker: true },
  projections: { title: "Projections",       subtitle: "Future at-bat modeling",               showLookback: false, showDatePicker: true },
  environment: { title: "Environment",       subtitle: "Park, weather, and wind conditions",   showLookback: false, showDatePicker: true },
  slips:       { title: "Slip Generator",    subtitle: "Build multi-leg parlays",              showLookback: true,  showDatePicker: true },
  bvp:         { title: "Batter vs Pitcher", subtitle: "Head-to-head history",                 showLookback: true,  showDatePicker: true },
  team_pitch_mix: { title: "Team vs Pitch Mix", subtitle: "Lineup stats vs opposing pitcher's arsenal", showLookback: false, showDatePicker: true },
  breakouts:   { title: "Breakouts & Regression", subtitle: "Over- and under-performers vs xHR from bat-tracking stats", showLookback: false, showDatePicker: false },
  live:        { title: "Live Feed",         subtitle: "Real-time + historical game action",   showLookback: false, showDatePicker: true },
methodology: { title: "How It Works",      showLookback: false, showDatePicker: false },
  matchup:         { title: "Matchup Analysis",  subtitle: "Season-long hitter vs pitcher",          showLookback: false, showDatePicker: true },
  pitcher_summary: { title: "Pitcher Summary",   subtitle: "All starters on today's slate — sortable by any stat", showLookback: false, showDatePicker: true },
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

type SlateGame = { game_pk: number; away_team: string; home_team: string; game_time?: string; game_status?: string; game_status_reason?: string };

function gameStatusBadge(status?: string, reason?: string): { label: string; color: string } | null {
  if (!status || status === "Scheduled" || status === "Pre-Game") return null;
  if (/postponed/i.test(status)) return { label: "PPD" + (reason ? ` · ${reason}` : ""), color: "#ef4444" };
  if (/delayed/i.test(status)) return { label: "DELAYED" + (reason ? ` · ${reason}` : ""), color: "#fbbf24" };
  if (/suspended/i.test(status)) return { label: "SUSP", color: "#f97316" };
  if (/in progress/i.test(status)) return { label: "LIVE", color: "#22c55e" };
  if (/final/i.test(status)) return { label: "FINAL", color: "#71717a" };
  return null;
}

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
          const badge = gameStatusBadge(game.game_status, game.game_status_reason);
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
              <div className="flex items-center justify-center gap-1.5 w-full">
                <div className="flex gap-1 items-center">
                  <img
                    src={teamLogoUrl(game.away_team)}
                    alt={game.away_team}
                    className="w-4 h-4 object-contain"
                    loading="lazy"
                  />
                  <span className="text-sm font-medium text-foreground">{game.away_team}</span>
                </div>
                <span className="text-xs text-muted">@</span>
                <div className="flex gap-1 items-center">
                  <span className="text-sm font-medium text-foreground">{game.home_team}</span>
                  <img
                    src={teamLogoUrl(game.home_team)}
                    alt={game.home_team}
                    className="w-4 h-4 object-contain"
                    loading="lazy"
                  />
                </div>
              </div>
              {badge ? (
                <div
                  className="text-center text-[10px] font-semibold tracking-wide truncate px-1 py-0.5 rounded"
                  style={{ color: badge.color, background: `${badge.color}18` }}
                >
                  {badge.label}
                </div>
              ) : (
                <div className="text-center text-xs text-muted whitespace-nowrap">
                  {longDate}
                  {time && <span className="text-[9px] mx-1 align-middle">•</span>}
                  {time && time}
                </div>
              )}
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

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [input, setInput] = useState("");
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const attempt = async () => {
    if (!input || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input }),
      });
      if (res.ok) {
        onUnlock();
      } else {
        setShake(true);
        setInput("");
        setTimeout(() => setShake(false), 600);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--background)" }}>
      <div
        className="w-full max-w-sm mx-4 rounded-2xl p-8 flex flex-col gap-5"
        style={{
          background: "linear-gradient(180deg,rgba(255,255,255,0.05) 0%,rgba(255,255,255,0.02) 100%)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 24px 64px -16px rgba(0,0,0,0.6)",
        }}
      >
        <div className="text-center">
          <div className="text-lg font-bold text-foreground mb-1">Beeb Sheets</div>
          <div className="text-sm text-muted">Enter password to continue</div>
        </div>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && attempt()}
            placeholder="Password"
            autoFocus
            className={`w-full px-4 py-3 pr-11 rounded-xl text-sm text-foreground placeholder:text-muted/50 outline-none transition-all ${shake ? "animate-[shake_0.4s_ease]" : ""}`}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: `1px solid ${shake ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.12)"}`,
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted/50 hover:text-muted transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button
          onClick={attempt}
          disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-semibold text-background cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "var(--accent)" }}
        >
          {loading ? "Checking…" : "Unlock"}
        </button>
      </div>
    </div>
  );
}

export function Dashboard() {
  // null = still checking, false = locked, true = unlocked
  const [unlocked, setUnlocked] = useState<boolean | null>(IS_PROD ? null : true);
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

  // Check server-side whether the unlock cookie is already set (prod only).
  useEffect(() => {
    if (!IS_PROD) return;
    fetch("/api/unlock")
      .then((r) => r.json())
      .then((d) => setUnlocked(d.unlocked === true))
      .catch(() => setUnlocked(false));
  }, []);

  // Read initial state from URL hash: #page=rankings&date=2026-04-03&lookback=L5
  function getHashParam(key: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    return params.get(key) || fallback;
  }

  const [activePage, setActivePageRaw] = useState<Page>(() => {
    const p = getHashParam("page", "ml");
    // If stored hash points to hidden rankings page, redirect to ml
    return (p === "rankings" ? "ml" : p) as Page;
  });
  const [lookback, setLookbackRaw] = useState<UILookback>(() => getHashParam("lookback", "L5") as UILookback);
  const [selectedDate, setSelectedDate] = useState<string>(() => getHashParam("date", ""));
  const [selectedGames, setSelectedGames] = useState<Set<number>>(new Set()); // empty = all games
  const [selectedBatter, setSelectedBatter] = useState<SelectedBatter | null>(null);
  const [rankingsTab, setRankingsTab] = useState<"ml" | "combined" | "consensus" | "test">("ml");
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem("beeb:favorites");
      return raw ? new Set<string>(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  // Persist favorites so they survive reloads and stay in sync across the
  // Game Slate, Favorites tab, and Slip Generator.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("beeb:favorites", JSON.stringify([...favorites]));
    } catch {}
  }, [favorites]);

  // Shared HR filter criteria — one setting drives both the Batter Filter tab
  // and the Favorites tab. Persisted so it survives reloads.
  const [filterCriteria, setFilterCriteria] = useState<FilterCriteria>(() => {
    if (typeof window === "undefined") return DEFAULT_CRITERIA;
    try {
      const raw = window.localStorage.getItem("beeb:filter-criteria");
      return raw ? { ...DEFAULT_CRITERIA, ...JSON.parse(raw) } : DEFAULT_CRITERIA;
    } catch {
      return DEFAULT_CRITERIA;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("beeb:filter-criteria", JSON.stringify(filterCriteria));
    } catch {}
  }, [filterCriteria]);
  const [lineupOverride, setLineupOverride] = useState<LineupOverride | null>(null);

  // Update URL hash when state changes
  function updateHash(page: string, date: string, lb: string) {
    if (typeof window === "undefined") return;
    window.location.hash = `page=${page}&date=${date}&lookback=${lb}`;
  }

  const setActivePage = (p: Page) => {
    setActivePageRaw(p);
    updateHash(p, selectedDate, lookback);
  };
  const setLookback = (lb: UILookback) => {
    setLookbackRaw(lb);
    updateHash(activePage, selectedDate, lb);
  };

  const onToggleFavorite = (name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const loadDate = (dateStr: string) => {
    const base = dateStr ? `/data/${dateStr}.json` : "/data/latest.json";
    const url = `${base}?t=${Date.now()}`;
    fetch(url, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("No data for this date.");
        return res.json();
      })
      .then(async (d: ModelData) => {
        let cur = d;
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

  // Poll for slate updates every 5 minutes. Only active for today's date.
  useEffect(() => {
    if (!data) return;
    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
    if (data.date !== today) return;

    const knownGeneratedAt = data.generated_at ?? "";
    const knownPosted = new Set(
      (data.games ?? []).flatMap((g) => {
        const sides = [];
        if (g.team_pitch_mix?.home?.lineup_status === "posted") sides.push(`${g.home_team}-home`);
        if (g.team_pitch_mix?.away?.lineup_status === "posted") sides.push(`${g.away_team}-away`);
        return sides;
      })
    );

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/data/${today}.json?t=${Date.now()}`);
        if (!res.ok) return;
        const fresh = await res.json();
        if (!fresh.generated_at || fresh.generated_at === knownGeneratedAt) return;

        // Count newly posted lineups
        const newlyPosted: string[] = [];
        for (const g of fresh.games ?? []) {
          if (g.team_pitch_mix?.home?.lineup_status === "posted" && !knownPosted.has(`${g.home_team}-home`))
            newlyPosted.push(g.home_team);
          if (g.team_pitch_mix?.away?.lineup_status === "posted" && !knownPosted.has(`${g.away_team}-away`))
            newlyPosted.push(g.away_team);
        }

        const msg = newlyPosted.length > 0
          ? `Lineups posted: ${newlyPosted.join(", ")}`
          : "Slate updated with new data";

        toast(msg, {
          duration: Infinity,
          action: { label: "Reload", onClick: () => loadDate(today) },
        });

        clearInterval(id);
      } catch {}
    }, 5 * 60 * 1000);

    return () => clearInterval(id);
  }, [data?.generated_at]);

  // Password gate — prod only. null = still checking cookie via API.
  if (unlocked === null) return null;
  if (unlocked === false) {
    return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  }

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

            {/* RIGHT slot (date + lookback + user menu) */}
            <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
              {tabConfig.showLookback && !(activePage === "slate" && selectedBatter) && !(activePage === "ml" && (rankingsTab === "combined" || rankingsTab === "consensus" || rankingsTab === "test")) && (
                <LookbackToggle value={lookback} onChange={setLookback} />
              )}
              {tabConfig.showDatePicker && (
                <DatePicker currentDate={selectedDate} onChange={loadDate} />
              )}
              {(activePage === "ml" || activePage === "slate") && data?.date && (
                <RefreshLineupsButton date={data.date} onOverrideChange={setLineupOverride} />
              )}
              <UserMenu />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-8">
          {activePage === "ml" && (
            <MLRankings games={data.games} lookback={lookback} currentDate={data.date} onTabChange={setRankingsTab} lineupOverride={lineupOverride} />
          )}

          {activePage === "slate" && selectedBatter ? (
            <BatterDetailPage
              player={selectedBatter.player}
              lookback={lookback}
              mlbId={selectedBatter.mlbId}
              battingOrder={selectedBatter.battingOrder}
              teamAbbr={selectedBatter.teamAbbr}
              onBack={() => setSelectedBatter(null)}
              isFavorited={favorites.has(selectedBatter.player.name)}
              onToggleFavorite={onToggleFavorite}
              parkFactor={selectedBatter.parkFactor}
              opposingArsenal={(() => {
                // Find the opposing pitcher's full vs-hand arsenal. batter_side
                // "home" faces away_pitcher; "away" faces home_pitcher. Falls
                // back to the overall arsenal if no hand-specific one exists.
                const game = data.games.find((g) =>
                  g.players.some((p) => p.name === selectedBatter.player.name)
                );
                if (!game) return null;
                const oppPitcher = selectedBatter.player.batter_side === "home"
                  ? game.away_pitcher : game.home_pitcher;
                const prof = oppPitcher?.profile;
                if (!prof) return null;
                if (selectedBatter.player.batter_hand === "L") return prof.arsenal_vs_L ?? prof.arsenal ?? null;
                if (selectedBatter.player.batter_hand === "R") return prof.arsenal_vs_R ?? prof.arsenal ?? null;
                return prof.arsenal ?? null;
              })()}
              gamePlayers={(() => {
                const game = data.games.find((g) =>
                  g.players.some((p) => p.name === selectedBatter.player.name)
                );
                if (!game) return undefined;
                // Restrict the Switch Hitter dropdown to the batter's OWN
                // team only — opposing-team hitters live in their own card.
                const targetSide = selectedBatter.player.batter_side;
                // Build name → batting-order lookup from that side's posted /
                // projected lineup. Players without a lineup slot get null
                // order (still selectable, sorted to the bottom).
                const orderByName = new Map<string, number>();
                const sd = targetSide === "home" || targetSide === "away"
                  ? game.team_pitch_mix?.[targetSide]
                  : undefined;
                if (sd) {
                  for (const b of sd.batters) {
                    if (b.name && b.order != null && b.order >= 1 && b.order <= 9) {
                      orderByName.set(b.name, b.order);
                    }
                  }
                }
                const seen = new Set<string>();
                const list: Array<{ name: string; battingOrder: number | null; hand: string; isSelf: boolean }> = [];
                for (const p of game.players) {
                  if (p.batter_side !== targetSide) continue;
                  if (seen.has(p.name)) continue;
                  seen.add(p.name);
                  list.push({
                    name: p.name,
                    battingOrder: orderByName.get(p.name) ?? null,
                    hand: p.batter_hand ?? "?",
                    isSelf: p.name === selectedBatter.player.name,
                  });
                }
                // Sort: posted-order batters first (1..9), then everyone else
                // alphabetically.
                list.sort((a, b) => {
                  if (a.battingOrder != null && b.battingOrder == null) return -1;
                  if (a.battingOrder == null && b.battingOrder != null) return 1;
                  if (a.battingOrder != null && b.battingOrder != null) return a.battingOrder - b.battingOrder;
                  return a.name.localeCompare(b.name);
                });
                return list;
              })()}
              onSwitchPlayer={(name) => {
                const game = data.games.find((g) =>
                  g.players.some((p) => p.name === name)
                );
                if (!game) return;
                const player = game.players.find((p) => p.name === name);
                if (!player) return;
                const sideKey = player.batter_side === "home" ? "home" : "away";
                const battersBlock = game.team_pitch_mix?.[sideKey]?.batters ?? [];
                const matched = battersBlock.find((b) => b.name === name);
                setSelectedBatter({
                  player,
                  mlbId: matched?.id,
                  battingOrder: matched?.order ?? null,
                  teamAbbr: sideKey === "home" ? game.home_team : game.away_team,
                  parkFactor: game.environment?.park_factor ?? undefined,
                });
              }}
            />
          ) : activePage === "slate" && (
            <>
              <SlateGameFilter
                games={data.games}
                date={data.date}
                selected={selectedGames}
                onSelect={(pk) => setSelectedGames(new Set([pk]))}
              />
              {data.games.filter((g) => selectedGames.has(g.game_pk)).map((game) => (
                <GameSection
                  key={game.game_pk}
                  game={game}
                  lookback={lookback}
                  onSelectBatter={setSelectedBatter}
                  favorites={favorites}
                  onToggleFavorite={onToggleFavorite}
                  lineupOverride={lineupOverride ? new Set(lineupOverride.starters) : null}
                  slateDate={data.date}
                />
              ))}
              {data.games.length === 0 && (
                <p className="text-center text-muted py-12">No games with scored players today.</p>
              )}
            </>
          )}

          {activePage === "hr_due" && (
            <HRDueList
              games={data.games}
              lookback={lookback}
              onSelectBatter={(s) => { setSelectedBatter(s); setActivePage("slate"); }}
            />
          )}

          {activePage === "projections" && (
            <ProjectionsView games={data.games} lookback={lookback} />
          )}

          {activePage === "environment" && (
            <EnvironmentView games={envGames} />
          )}

          {activePage === "live" && (
            <LiveFeed selectedDate={selectedDate} />
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

          {activePage === "favorites" && (
            <FavoritesPage
              games={data.games}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
              onSelectBatter={(s) => { setSelectedBatter(s); setActivePage("slate"); }}
              criteria={filterCriteria}
              onCriteriaChange={setFilterCriteria}
            />
          )}

          {activePage === "batter_filter" && (
            <BatterFilterPage
              games={data.games}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
              onSelectBatter={(s) => { setSelectedBatter(s); setActivePage("slate"); }}
              criteria={filterCriteria}
              onCriteriaChange={setFilterCriteria}
            />
          )}

          {activePage === "slips" && (
            <SlipGenerator games={data.games} lookback={lookback} favorites={favorites} onUnfavorite={(name) => setFavorites((prev) => { const n = new Set(prev); n.delete(name); return n; })} />
          )}

          {activePage === "pitcher_summary" && (
            <PitcherSummaryPage games={data.games} />
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
