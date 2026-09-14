"use client";

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { CARD, color } from "../../_design";
import type { NflSlate, NflPlayer } from "./types";
import { fmtPct, fmtPct1, scoreColor, posColor, matchupColor, matchupLabel, teamLogo } from "./format";

const TOP_N = 30;

// RBs structurally score higher than every other position (goal-line carries
// concentrate red-zone volume in a way WR/TE/QB usage never does), so a single
// pooled Top-N buries everyone else. Rank each position on its own board.
const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;
type PosFilter = (typeof POSITIONS)[number];

function Pill({ label, value, c }: { label: string; value: string; c?: string }) {
  return (
    <div className="flex flex-col items-center min-w-[52px]">
      <span className="text-[9px] uppercase tracking-wider" style={{ color: color.muted }}>{label}</span>
      <span className="text-[13px] font-semibold font-mono" style={{ color: c ?? color.foreground }}>{value}</span>
    </div>
  );
}

// Official injury report_status -> badge color. "Out"/"Doubtful" are effectively
// won't-play; "Questionable" is a real coin flip, still worth flagging.
function injuryColor(status: string | null): string | null {
  if (!status) return null;
  if (status === "Out" || status === "Doubtful") return color.red;
  if (status === "Questionable") return color.yellow;
  return null;
}

function Row({
  p, rank, fav, onToggleFavorite, onSelect,
}: {
  p: NflPlayer; rank: number; fav: boolean; onToggleFavorite: (id: string) => void; onSelect: (p: NflPlayer) => void;
}) {
  const mColor = matchupColor(p.opp_rank_vs_role, p.opp_rank_total);
  const mLabel = matchupLabel(p.opp_rank_vs_role, p.opp_rank_total);
  const usage = p.pos === "RB" ? `${p.carries_pg} car/g` : `${p.targets_pg} tgt/g`;
  const iColor = injuryColor(p.injury_status);
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:brightness-125 transition-[filter]"
      style={CARD.simple}
      onClick={() => onSelect(p)}
    >
      <span className="w-6 text-[13px] font-bold text-right shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>{rank}</span>
      <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(p.gsis_id); }} className="cursor-pointer shrink-0" aria-label="favorite">
        <Star size={14} fill={fav ? color.yellow : "none"} stroke={fav ? color.yellow : "rgba(255,255,255,0.25)"} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={teamLogo(p.team)} alt={p.team} className="w-6 h-6 object-contain shrink-0" style={{ width: 24, height: 24 }} />

      {/* name + role + the matchup headline */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-foreground truncate">{p.name}</span>
          <span className="text-[10px] font-bold shrink-0 px-1 rounded" style={{ color: posColor(p.pos), background: "rgba(255,255,255,0.06)" }}>{p.role}</span>
          {iColor && (
            <span
              className="text-[9px] font-bold shrink-0 px-1 rounded uppercase tracking-wide"
              style={{ color: iColor, background: `${iColor}1a`, border: `1px solid ${iColor}55` }}
              title={[p.injury_status, p.injury_detail].filter(Boolean).join(" — ") || undefined}
            >
              {p.injury_status}
            </span>
          )}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: color.muted }}>
          {p.team} <span style={{ color: "rgba(255,255,255,0.3)" }}>vs</span> {p.opponent}
          <span className="mx-1"> </span>
          <span style={{ color: mColor, fontWeight: 600 }}>#{p.opp_rank_vs_role}/{p.opp_rank_total} vs {p.role}</span>
          <span className="mx-1.5">·</span>imp {p.implied_team_total}
          <span className="mx-1.5">·</span>{usage}
        </div>
      </div>

      {/* stat pills */}
      <div className="hidden md:flex items-center gap-3 shrink-0">
        <Pill label="Hit% Szn" value={fmtPct(p.hit_rate_season)} />
        <Pill label="Hit% L5" value={fmtPct(p.hit_rate_l5)} />
        <Pill label="RZ Opp%" value={fmtPct(p.rz_opp_share)} />
        <Pill label="Snap%" value={fmtPct(p.snap_pct)} />
      </div>

      {/* matchup label + score */}
      <div className="flex items-center gap-3 shrink-0 pl-1">
        <span className="text-[10px] font-bold uppercase tracking-wider w-12 text-center" style={{ color: mColor }}>{mLabel}</span>
        <div className="text-right w-16">
          <div className="text-[18px] font-bold font-mono leading-none" style={{ color: scoreColor(p.score) }}>{fmtPct1(p.score)}</div>
          <div className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: color.muted }}>TD prob</div>
        </div>
      </div>
    </div>
  );
}

export function Rankings({
  slate, favorites, onToggleFavorite, onSelect,
}: {
  slate: NflSlate; favorites: Set<string>; onToggleFavorite: (id: string) => void; onSelect: (p: NflPlayer) => void;
}) {
  const [pos, setPos] = useState<PosFilter>("ALL");

  const top = useMemo(() => {
    const all = slate.games.flatMap((g) => g.players);
    const filtered = pos === "ALL" ? all : all.filter((p) => p.pos === pos);
    return [...filtered].sort((a, b) => b.score - a.score).slice(0, TOP_N);
  }, [slate, pos]);

  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [downloadError, setDownloadError] = useState<string>("");
  const [copyState, setCopyState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [copyError, setCopyError] = useState<string>("");

  // Pure canvas builder — one source of truth so download and copy-to-clipboard
  // produce byte-identical PNGs. Same layout convention as the MLB rankings
  // export (900w canvas, text-only rows, "Beeb Sheets" watermark).
  const buildRankingsCanvas = (): HTMLCanvasElement => {
    const DPR = 2;
    const W = 900;
    const PAD = 28;
    const ROW_H = 64;
    const HEADER_H = 72;
    const FOOTER_H = 44;
    const rows = top;
    const H = HEADER_H + rows.length * (ROW_H + 8) + FOOTER_H + PAD;

    const canvas = document.createElement("canvas");
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(DPR, DPR);

    ctx.fillStyle = "#111113";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#e4e4e7";
    ctx.font = "bold 22px Inter, system-ui, sans-serif";
    ctx.fillText(`Top ${TOP_N} ${pos === "ALL" ? "" : pos + " "}Anytime-TD Plays`, PAD, 34);
    ctx.fillStyle = "#71717a";
    ctx.font = "13px Inter, system-ui, sans-serif";
    ctx.fillText(`${rows.length} players · ranked by model TD probability · Beeb Sheets`, PAD, 56);

    const COL = { rank: PAD, name: PAD + 36, hitSzn: 480, hitL5: 550, rz: 620, snap: 690, matchup: 760, score: W - PAD };
    ctx.fillStyle = "#52525b";
    ctx.font = "bold 9px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ["HIT% SZN", "HIT% L5", "RZ OPP%", "SNAP%"].forEach((lbl, i) => {
      ctx.fillText(lbl, [COL.hitSzn, COL.hitL5, COL.rz, COL.snap][i], HEADER_H - 10);
    });
    ctx.fillText("MATCHUP", COL.matchup, HEADER_H - 10);
    ctx.textAlign = "right";
    ctx.fillText("SCORE", COL.score, HEADER_H - 10);
    ctx.textAlign = "left";

    rows.forEach((p, i) => {
      const y = HEADER_H + i * (ROW_H + 8);
      ctx.beginPath();
      ctx.roundRect(PAD - 8, y, W - (PAD - 8) * 2, ROW_H, 10);
      ctx.fillStyle = "#1c1c1e";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.stroke();
      const cy = y + ROW_H / 2;

      // Rank
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "bold 13px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), COL.rank + 6, cy + 5);
      ctx.textAlign = "left";

      // Name + role badge (+ injury tag if flagged)
      ctx.fillStyle = "#e4e4e7";
      ctx.font = "bold 15px Inter, system-ui, sans-serif";
      ctx.fillText(p.name, COL.name, cy - 6);
      const nameW = ctx.measureText(p.name).width;
      ctx.font = "bold 10px Inter, system-ui, sans-serif";
      ctx.fillStyle = posColor(p.pos);
      ctx.fillText(p.role, COL.name + nameW + 8, cy - 6);
      let tagX = COL.name + nameW + 8 + ctx.measureText(p.role).width + 8;
      const iColor = injuryColor(p.injury_status);
      if (iColor && p.injury_status) {
        ctx.fillStyle = iColor;
        ctx.fillText(p.injury_status.toUpperCase(), tagX, cy - 6);
        tagX += ctx.measureText(p.injury_status.toUpperCase()).width;
      }

      // Matchup line
      const mLabel = matchupLabel(p.opp_rank_vs_role, p.opp_rank_total);
      const mColor = matchupColor(p.opp_rank_vs_role, p.opp_rank_total);
      ctx.fillStyle = "#71717a";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillText(`${p.team} vs ${p.opponent} · #${p.opp_rank_vs_role}/${p.opp_rank_total} vs ${p.role} · imp ${p.implied_team_total}`, COL.name, cy + 10);

      // Stats
      const drawStat = (val: string, x: number) => {
        ctx.fillStyle = "#e4e4e7";
        ctx.font = "bold 13px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(val, x, cy + 5);
        ctx.textAlign = "left";
      };
      drawStat(fmtPct(p.hit_rate_season), COL.hitSzn);
      drawStat(fmtPct(p.hit_rate_l5), COL.hitL5);
      drawStat(fmtPct(p.rz_opp_share), COL.rz);
      drawStat(fmtPct(p.snap_pct), COL.snap);

      // Matchup label
      ctx.fillStyle = mColor;
      ctx.font = "bold 11px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(mLabel, COL.matchup, cy + 5);
      ctx.textAlign = "left";

      // Score
      ctx.fillStyle = scoreColor(p.score);
      ctx.font = "bold 22px Inter, system-ui, sans-serif";
      const scoreTxt = fmtPct1(p.score);
      const scoreW = ctx.measureText(scoreTxt).width;
      ctx.fillText(scoreTxt, COL.score - scoreW, cy + 8);
    });

    const fy = H - 14;
    ctx.fillStyle = "#3f3f46";
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    const wm = "Beeb Sheets";
    const wmW = ctx.measureText(wm).width;
    ctx.fillText(wm, W / 2 - wmW / 2, fy);

    return canvas;
  };

  const downloadPng = () => {
    if (downloadState === "loading") return;
    setDownloadState("loading");
    try {
      const canvas = buildRankingsCanvas();
      const link = document.createElement("a");
      link.download = `beeb-nfl-rankings-${pos === "ALL" ? "all" : pos.toLowerCase()}.png`;
      link.href = canvas.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setDownloadState("done");
      setTimeout(() => setDownloadState("idle"), 2500);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
      setDownloadState("error");
      setTimeout(() => setDownloadState("idle"), 4000);
    }
  };

  const copyPng = () => {
    if (copyState === "loading") return;
    setCopyState("loading");
    try {
      const canvas = buildRankingsCanvas();
      const item = new ClipboardItem({
        "image/png": new Promise<Blob>((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
        ),
      });
      navigator.clipboard.write([item]).then(
        () => { setCopyState("done"); setTimeout(() => setCopyState("idle"), 2500); },
        (err) => {
          setCopyError(err instanceof Error ? err.message : String(err));
          setCopyState("error");
          setTimeout(() => setCopyState("idle"), 4000);
        },
      );
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : String(err));
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 4000);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[18px] font-semibold text-foreground tracking-[-0.005em]">
            Top {TOP_N} {pos === "ALL" ? "" : pos + " "}Anytime-TD Plays
          </h2>
          <span className="text-[11px] hidden sm:inline" style={{ color: color.muted }}>ranked by model TD probability</span>
        </div>
        <div className="flex items-center gap-1">
          {POSITIONS.map((key) => (
            <button
              key={key}
              onClick={() => setPos(key)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors"
              style={
                pos === key
                  ? { background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)", color: color.accent }
                  : { background: "transparent", border: "1px solid #2c2c2e", color: color.muted }
              }
            >
              {key}
            </button>
          ))}
          <button
            onClick={downloadPng}
            disabled={downloadState === "loading"}
            title="Download as PNG"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all text-[11px] font-semibold border ${
              downloadState === "done"
                ? "bg-accent-green/15 border-accent-green/40 text-accent-green"
                : downloadState === "error"
                ? "bg-red-500/15 border-red-500/40 text-red-400"
                : downloadState === "loading"
                ? "bg-card/50 border-card-border text-muted opacity-60"
                : "bg-card/50 border-card-border text-muted hover:border-accent/40 hover:text-accent"
            }`}
          >
            {downloadState === "loading" ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Generating…
              </>
            ) : downloadState === "done" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Downloaded!
              </>
            ) : downloadState === "error" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {downloadError ? downloadError.slice(0, 40) : "Failed"}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                PNG
              </>
            )}
          </button>
          <button
            onClick={copyPng}
            disabled={copyState === "loading"}
            title="Copy image to clipboard (same as PNG)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-all text-[11px] font-semibold border ${
              copyState === "done"
                ? "bg-accent-green/15 border-accent-green/40 text-accent-green"
                : copyState === "error"
                ? "bg-red-500/15 border-red-500/40 text-red-400"
                : copyState === "loading"
                ? "bg-card/50 border-card-border text-muted opacity-60"
                : "bg-card/50 border-card-border text-muted hover:border-accent/40 hover:text-accent"
            }`}
          >
            {copyState === "loading" ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Copying…
              </>
            ) : copyState === "done" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : copyState === "error" ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {copyError ? copyError.slice(0, 40) : "Failed"}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="9" y="9" width="11" height="11" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {top.map((p, i) => (
          <Row key={p.gsis_id + p.team} p={p} rank={i + 1} fav={favorites.has(p.gsis_id)} onToggleFavorite={onToggleFavorite} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
