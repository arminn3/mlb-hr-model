"use client";

import { useState } from "react";
import type { PitcherScratch } from "./pitcher-scratch";

export function ScratchedPitcherBanner({
  scratch,
  originalHand,
  onClear,
}: {
  scratch: PitcherScratch;
  originalHand: "L" | "R";
  onClear: () => void;
}) {
  // Platoon flip = if the replacement throws with the opposite hand, every batter's
  // platoon advantage just flipped. Critical signal for HR betting.
  const platoonFlip = scratch.replacementHand !== originalHand;

  return (
    <div
      className="rounded-lg px-3 py-2 mb-3 flex items-center gap-3"
      style={{
        background: "rgba(239,68,68,0.10)",
        border: "1px solid rgba(239,68,68,0.32)",
      }}
    >
      <span className="text-[11px] font-bold uppercase tracking-wider text-red-400 whitespace-nowrap">
        Scratched
      </span>
      <div className="flex-1 text-[12px] text-foreground leading-tight">
        <span className="line-through text-foreground/55">{scratch.originalName}</span>
        {" → "}
        <span className="font-semibold">{scratch.replacementName}</span>
        <span className="ml-1.5 px-1 py-0.5 text-[9px] font-mono font-bold rounded bg-white/10 text-foreground/80">
          {scratch.replacementHand}HP
        </span>
        {platoonFlip && (
          <span className="ml-2 text-[11px] font-semibold text-amber-400">
            Platoon flip — ratings stale
          </span>
        )}
      </div>
      <button
        onClick={onClear}
        className="text-[10px] text-muted hover:text-foreground cursor-pointer"
        title="Clear scratch override"
      >
        clear
      </button>
    </div>
  );
}

export function MarkScratchedButton({
  originalName,
  originalHand,
  onSave,
}: {
  originalName: string;
  originalHand: "L" | "R";
  onSave: (replacementName: string, replacementHand: "L" | "R") => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hand, setHand] = useState<"L" | "R">(originalHand);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md cursor-pointer transition-colors flex items-center gap-1.5"
        style={{
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.40)",
          color: "rgb(252,165,165)",
        }}
        title={`Mark ${originalName} as scratched`}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Mark Scratched
      </button>
    );
  }

  return (
    <div
      className="rounded-md px-2 py-1.5 flex items-center gap-1.5"
      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Replacement"
        className="bg-transparent text-[11px] text-foreground placeholder:text-muted/50 outline-none w-28"
      />
      <div className="flex">
        {(["L", "R"] as const).map((h) => (
          <button
            key={h}
            onClick={() => setHand(h)}
            className={`px-1.5 py-0.5 text-[10px] font-mono font-bold cursor-pointer ${
              hand === h ? "bg-accent text-background" : "text-foreground/55 hover:text-foreground"
            }`}
          >
            {h}
          </button>
        ))}
      </div>
      <button
        onClick={() => {
          if (!name.trim()) return;
          onSave(name.trim(), hand);
          setOpen(false);
          setName("");
        }}
        className="text-[10px] font-bold text-accent-green hover:text-accent-green/80 cursor-pointer ml-1"
      >
        save
      </button>
      <button
        onClick={() => { setOpen(false); setName(""); }}
        className="text-[10px] text-muted hover:text-foreground cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
}
