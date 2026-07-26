/**
 * Approximate MLB outfield fence distances (feet) per park, keyed by the app's
 * home-team abbreviation. Points, left→right: LF line, LF alley (LCF), CF,
 * RF alley (RCF), RF line. Used to draw the actual (asymmetric) wall on the
 * spray chart for the park a game is played in today.
 *
 * These are close-enough backdrops, not surveyed contours. Update a row if a
 * park is reconfigured. Unknown teams fall back to GENERIC_PARK.
 */
export interface ParkDims {
  lf: number;
  lcf: number;
  cf: number;
  rcf: number;
  rf: number;
}

export const GENERIC_PARK: ParkDims = { lf: 330, lcf: 375, cf: 400, rcf: 375, rf: 330 };

export const PARK_DIMS: Record<string, ParkDims> = {
  AZ:  { lf: 330, lcf: 374, cf: 407, rcf: 374, rf: 335 },
  ATL: { lf: 335, lcf: 385, cf: 400, rcf: 375, rf: 325 },
  BAL: { lf: 333, lcf: 384, cf: 400, rcf: 373, rf: 318 },
  BOS: { lf: 310, lcf: 379, cf: 390, rcf: 380, rf: 302 },
  CHC: { lf: 355, lcf: 368, cf: 400, rcf: 368, rf: 353 },
  CWS: { lf: 330, lcf: 377, cf: 400, rcf: 372, rf: 335 },
  CIN: { lf: 328, lcf: 379, cf: 404, rcf: 370, rf: 325 },
  CLE: { lf: 325, lcf: 370, cf: 405, rcf: 375, rf: 325 },
  COL: { lf: 347, lcf: 390, cf: 415, rcf: 375, rf: 350 },
  DET: { lf: 345, lcf: 370, cf: 420, rcf: 365, rf: 330 },
  HOU: { lf: 315, lcf: 362, cf: 409, rcf: 373, rf: 326 },
  KC:  { lf: 330, lcf: 387, cf: 410, rcf: 387, rf: 330 },
  LAA: { lf: 330, lcf: 387, cf: 396, rcf: 370, rf: 330 },
  LAD: { lf: 330, lcf: 385, cf: 395, rcf: 385, rf: 330 },
  MIA: { lf: 344, lcf: 386, cf: 400, rcf: 392, rf: 335 },
  MIL: { lf: 344, lcf: 371, cf: 400, rcf: 374, rf: 345 },
  MIN: { lf: 339, lcf: 377, cf: 404, rcf: 367, rf: 328 },
  NYM: { lf: 335, lcf: 379, cf: 408, rcf: 383, rf: 330 },
  NYY: { lf: 318, lcf: 399, cf: 408, rcf: 385, rf: 314 },
  ATH: { lf: 326, lcf: 375, cf: 403, rcf: 375, rf: 325 },
  PHI: { lf: 329, lcf: 374, cf: 401, rcf: 369, rf: 330 },
  PIT: { lf: 325, lcf: 389, cf: 399, rcf: 375, rf: 320 },
  SD:  { lf: 336, lcf: 367, cf: 396, rcf: 391, rf: 322 },
  SF:  { lf: 339, lcf: 364, cf: 399, rcf: 421, rf: 309 },
  SEA: { lf: 331, lcf: 378, cf: 401, rcf: 381, rf: 326 },
  STL: { lf: 336, lcf: 375, cf: 400, rcf: 375, rf: 335 },
  TB:  { lf: 315, lcf: 370, cf: 404, rcf: 370, rf: 322 },
  TEX: { lf: 329, lcf: 372, cf: 407, rcf: 374, rf: 326 },
  TOR: { lf: 328, lcf: 375, cf: 400, rcf: 375, rf: 328 },
  WSH: { lf: 336, lcf: 377, cf: 402, rcf: 370, rf: 335 },
};

export function parkDimsFor(teamAbbr?: string | null): ParkDims {
  if (!teamAbbr) return GENERIC_PARK;
  return PARK_DIMS[teamAbbr] ?? GENERIC_PARK;
}
