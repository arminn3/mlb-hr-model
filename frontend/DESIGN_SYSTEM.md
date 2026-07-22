# Beeb Sheets Design System

The single source of truth for how the app looks. **All new code — especially the
NFL section — imports from `src/app/_design` and never invents its own colors,
gradients, or font sizes.** This is what keeps MLB and NFL visually identical and
stops one sport's styling from drifting or breaking the other.

Preview everything live at the `/design` route (dev-only, never linked in-app).

---

## The one rule

> **Do not hardcode a color, a gradient, a shadow, or a `text-[Npx]` size.**
> Pull it from `_design`: a token (`color.green`), a preset (`CARD.elevated`,
> `heat()`), a type class (`type.title`), or a primitive (`<Badge>`, `<Card>`).

If something you need isn't in `_design`, **add it to `_design`** (and to this
doc + the `/design` page) rather than inlining it in a component.

---

## Import surface

```ts
import {
  color, surface, border, radius, shadow, motion, intentRGB, type, // tokens
  CARD, heat, heatLevel,                                            // presets
  Badge, Button, Card, CardHeader, CardTitle, CardMeta, CardBody,   // primitives
  CardFooter, Chip, IconButton, Skeleton, EmptyState, Icon,
  Tooltip, RatingBadge, StatPill, ScoreBar,
} from "@/app/_design"; // (or a relative path to src/app/_design)
```

The CSS custom properties these mirror live in `src/app/globals.css`. For Tailwind
class usage, the tokens are also exposed as utilities (`text-foreground`,
`text-muted`, `text-accent-green`, `bg-surface-2`, `border-card-border`, etc.).

---

## Tokens (`_design/tokens.ts`)

**Colors** — `color.*`: `background #141414`, `foreground #e4e4e7`, `card #1c1c1e`,
`cardBorder #2c2c2e`, `accent #60a5fa`, `green #4ade80`, `yellow #fbbf24`,
`red #f87171`, `muted #71717a`.

**Intent meaning:** green = good/positive, yellow = medium/caution, red =
bad/negative, accent(blue) = selected/primary, muted = secondary text.

**Surfaces** — `surface.*`: `s1 #1c1c1e` (base card), `s2 #232326` (raised/hover),
`s3 #2a2a2e` (popover), `sunken #161618` (filter trough). **Borders** —
`border.subtle #2c2c2e`, `border.strong #3a3a3e`.

**Radius** `radius.*`: sm 4 · md 8 · lg 12 · xl 16. **Shadow** `shadow.*`: sm/md/lg.
**Motion** `motion.*`: `easeOut`, `fast 120ms`, `base 200ms`.

**Typography** — the locked 6-step scale (`type.*`, apply as a className):

| preset | size / line / weight |
|---|---|
| `display` | 24 / 32 / 600 |
| `title` | 18 / 24 / 600 |
| `body` | 14 / 20 / 400 |
| `label` | 12 / 16 / 500 |
| `caption` | 11 / 14 / 500 |
| `micro` | 10 / 12 / 600 UPPER |

Min readable size is **10px** (micro); nothing smaller outside `table-styles.ts`.
Font is **Inter** (sans), **Geist Mono** for numerals/stats only — never swap these.

---

## Surface presets (`_design/surfaces.ts`)

Spread into a `style={}` next to a rounded/padding class:

- `CARD.elevated` — main content card (gradient + highlight + drop shadow).
- `CARD.simple` — small flat stat card.
- `CARD.filterBar` — control/filter bar.
- `CARD.panel` — collapsible secondary panel.
- `heat(intent, level)` — stat-pill / dynamic bg; `level` 0 flat · 1 warm · 2 hot.
- `heatLevel(value, low, high, invert?)` — map a stat value → a heat level.

```tsx
<div className="rounded-xl p-4" style={CARD.elevated}>…</div>
<span className="px-1.5 py-0.5 rounded" style={heat("green", heatLevel(brl, 8, 15))}>
  {brl}%
</span>
```

---

## Primitives (`_components/ui` + a few in `_components`)

`Badge`, `Chip`, `Card` (+ `CardHeader/Title/Meta/Body/Footer`), `Button`,
`IconButton`, `Skeleton`, `EmptyState`, `Icon` (lucide registry — add icons in
`icon.tsx`), `Tooltip`, `RatingBadge`, `StatPill`, `ScoreBar`.

Prefer a primitive over bespoke markup. Need a new one? Add it under
`_components/ui`, export it from `_design/index.ts`, and show it on `/design`.

---

## Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| `style={CARD.elevated}` | inline `linear-gradient(... rgba ...)` |
| `color.green` / `text-accent-green` | `#4ade80` / `text-[#4ade80]` |
| `className={type.title}` | random `text-[17px]` |
| `heat("red", 2)` for a hot pill | hand-tuned `rgba(248,113,113,0.22)` |
| add a token to `_design` | one-off value in a component |
| import from `@/app/_design` | import MLB `batter-*` files into NFL |

---

## Guardrails for the NFL build

- NFL components live in `_components/nfl/` and the `/nfl` route; they import only
  from `_design` (design) and their own NFL data/types (never MLB modules).
- MLB files are not edited while NFL is built — the design system is additive.
- Any new shared visual pattern goes into `_design` first, then into both sports.
