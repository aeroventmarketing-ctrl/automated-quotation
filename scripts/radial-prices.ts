/**
 * Radial Blower selling prices (PHP), keyed by size code. Supplied by the client
 * and shared across all three blade catalogues — Paddle Wheel (CMH), Ring Paddle
 * Wheel (CMA), and Backplate Paddle Wheel (CMB). The stored price is the final
 * selling price, so TAG_FACTORS for CMH/CMA/CMB are ×1 in the quotation builder.
 *
 * Size code 8525 (85.25") is not yet priced and is held back from all three
 * catalogues until the client supplies it.
 */
export const RADIAL_PRICES: Record<string, number> = {
  "1281": 58689,
  "1562": 73170,
  "1912": 104931,
  "2262": 109962,
  "2612": 142902,
  "2962": 158469,
  "3300": 196299,
  "3650": 251481,
  "4000": 297843,
  "4512": 377325,
  "5050": 440016,
  "5750": 664488,
  "6437": 977505,
  "7125": 1077003,
  "7825": 1982073,
};
