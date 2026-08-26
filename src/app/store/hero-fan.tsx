/**
 * The hero's fan artwork — a five-blade axial propeller turning inside its
 * shroud, drawn as SVG so it stays crisp at any size and costs no image
 * request. Shown when no flagship hero photo is set.
 *
 * Only the blades and hub rotate; the shroud, the mounting bosses and the
 * struts behind stay put, which is what makes it read as a fan running rather
 * than the whole assembly spinning.
 *
 * Geometry note: one blade is drawn pointing up and the other four are the same
 * path rotated by 72°. The blade is a BANANA — a crescent bowing to one side —
 * and its sweep is still ZERO.
 *
 * Those two normally fight each other: a blade that curves to one side usually
 * carries its tip round with it, which is rake. Here they coexist because both
 * ENDS sit on the blade's own radial and only the body bows off it. The tip
 * stays square above the root, so sweep is zero, while the belly gives the
 * crescent its shape.
 */

/**
 * The blade, drawn once at 12 o'clock in a 200×200 box centred on (100,100).
 * Root at radius 26 (where the hub covers the join), tip at radius 78 — inside
 * the shroud's 82 throat, so the propeller turns within its housing instead of
 * cutting across it.
 *
 * Zero sweep lives in the two END CHORDS, not in the curve between them. Both
 * are horizontal — square to the radial — and both are centred on x = 100:
 * root (94,75)-(106,75), tip (94,28)-(106,28). The tip's centre therefore sits
 * directly above the root's, which is what sweep measures, and the caps are
 * exact semicircles across those chords.
 *
 * Everything the curve does in between is CAMBER, a different quantity, and it
 * is free: the back bows out to x≈122 and the belly follows at x≈100, giving
 * the crescent. Do not try to force the ends' TANGENTS parallel to the radial
 * as well — a curve that leaves straight, bows, and arrives straight is an S,
 * not a banana, and an attempt at it turned every blade into a worm.
 *
 * Move either chord off x = 100 and the blade rakes.
 */
const BLADE =
  "M 106 75 C 126 64 128 37 106 28 " + // convex back, bowing out to the crescent
  "A 6 6 0 0 0 94 28 " + //               tip cap — semicircle on a square chord
  "C 104 42 101 64 94 75 " + //           concave belly, back down the inside
  "A 6 6 0 0 0 106 75 Z"; //              root cap, bulging into the hub that hides it

const ANGLES = [0, 72, 144, 216, 288];

export function HeroFan() {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden
      className="h-[330px] w-[330px] animate-store-float drop-shadow-[0_34px_70px_rgba(0,0,0,0.53)] motion-reduce:animate-none"
    >
      <defs>
        {/* Light falling from the upper left, so the blades read as solid. */}
        <linearGradient id="hf-blade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8492a6" />
          <stop offset="55%" stopColor="#6d7b8e" />
          <stop offset="100%" stopColor="#4a5769" />
        </linearGradient>
        <radialGradient id="hf-ground">
          <stop offset="0%" stopColor="#25344a" />
          <stop offset="55%" stopColor="#111e32" />
          <stop offset="100%" stopColor="#0a1425" />
        </radialGradient>
        <radialGradient id="hf-hub">
          <stop offset="0%" stopColor="#3a4a5c" />
          <stop offset="100%" stopColor="#222f42" />
        </radialGradient>
      </defs>

      {/* Shroud: the outer ring and the throat the propeller sits in. */}
      <circle cx="100" cy="100" r="99" fill="url(#hf-ground)" stroke="#516078" strokeWidth="1" />
      <circle cx="100" cy="100" r="88" fill="none" stroke="#59667a" strokeWidth="1.5" opacity="0.65" />
      <circle cx="100" cy="100" r="82" fill="none" stroke="#69798e" strokeWidth="0.75" strokeDasharray="2 4" opacity="0.7" />

      {/* Four mounting bosses on the shroud face, at the diagonals. */}
      {[45, 135, 225, 315].map((a) => (
        <circle
          key={a}
          cx={100 + 93 * Math.cos((a * Math.PI) / 180)}
          cy={100 + 93 * Math.sin((a * Math.PI) / 180)}
          r="3"
          fill="#2b3a4f"
          stroke="#59667a"
          strokeWidth="0.75"
        />
      ))}

      {/* The rotating assembly. `origin-center` keeps it turning about the hub
          rather than the top-left of the box. */}
      <g className="origin-center animate-[spin_7s_linear_infinite] motion-reduce:animate-none">
        {ANGLES.map((a) => (
          <path
            key={a}
            d={BLADE}
            transform={`rotate(${a} 100 100)`}
            fill="url(#hf-blade)"
            stroke="#8b99ad"
            strokeWidth="0.6"
            strokeLinejoin="round"
            opacity="0.92"
          />
        ))}
        {/* Hub, and a spinner mark so the rotation is legible at a glance. */}
        <circle cx="100" cy="100" r="24" fill="url(#hf-hub)" stroke="#6d7b8e" strokeWidth="1.25" />
        <circle cx="100" cy="100" r="11" fill="#1a2637" stroke="#59667a" strokeWidth="1" />
        <path d="M 100 92 L 100 87" stroke="#8b99ad" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
