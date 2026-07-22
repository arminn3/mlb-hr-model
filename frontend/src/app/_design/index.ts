/**
 * Beeb Sheets shared design system — public API.
 *
 * Both sports (MLB, and NFL going forward) import from `@/app/_design`. NFL code
 * must NEVER hardcode colors, gradients, or one-off `text-[Npx]` — pull the
 * token, preset, or primitive from here. See `frontend/DESIGN_SYSTEM.md`.
 *
 * This file is purely additive: it re-exports the tokens defined here plus the
 * existing `_components/ui` primitives. It changes no existing rendering.
 */

// Tokens & style presets (defined in this module)
export * from "./tokens";
export * from "./surfaces";

// UI primitives (implemented in _components/ui and _components/*)
export { Badge } from "../_components/ui/badge";
export { Button } from "../_components/ui/button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardMeta,
  CardBody,
  CardFooter,
} from "../_components/ui/card";
export { Chip } from "../_components/ui/chip";
export { IconButton } from "../_components/ui/icon-button";
export { Skeleton } from "../_components/ui/skeleton";
export { EmptyState } from "../_components/ui/empty-state";
export { Icon } from "../_components/icon";
export { Tooltip } from "../_components/tooltip";
export { RatingBadge } from "../_components/rating-badge";
export { StatPill } from "../_components/stat-pill";
export { ScoreBar } from "../_components/score-bar";
