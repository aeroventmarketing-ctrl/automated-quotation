/**
 * The hero's fan artwork — a five-blade aircraft propeller, drawn as SVG so it
 * stays crisp at any size and costs no image request. Shown when no flagship
 * hero photo is set.
 *
 * Modelled on the propeller photo the owner supplied: matte black paddle
 * blades, twin white tip bands, a copper maker's decal partway up each blade,
 * and a polished hub with a retention collar per blade. The soft backlight
 * behind the hub is from that photo too, and it earns its place here — five
 * near-black blades on a near-black hero would otherwise vanish.
 *
 * Only the propeller turns. The glow stays put, which is what keeps it reading
 * as a light behind the prop rather than part of it.
 *
 * Sweep is still zero, as asked for earlier: the blade is symmetric about its
 * own radial, tip square above root. The reference blades look raked, but that
 * is the twist and the camera, not plan-form sweep.
 */

/**
 * One blade, drawn at 12 o'clock in a 200×200 box centred on (100,100).
 *
 * The plan-form is the photo's: a narrow shank leaving the hub, widening
 * through the middle third to a broad paddle, then a squared tip with rounded
 * corners. Root at radius 22 (under the hub, so the join never shows), tip at
 * radius 86.
 *
 * Both edges mirror about x = 100 — that mirror is the zero sweep.
 */
const BLADE =
  "M 103.8 78 C 104.2 66 105.2 54 107.5 42 " + // shank, staying narrow well past halfway
  "C 109.8 32 110.5 22 110 17 " + //              then flaring into the paddle
  "C 108 12.8 92 12.8 90 17 " + //                broad squared tip, corners rounded
  "C 89.5 22 90.2 32 92.5 42 " + //               trailing edge, the mirror of the leading
  "C 94.8 54 95.8 66 96.2 78 " +
  "A 3.8 3.8 0 0 0 103.8 78 Z"; //                root cap, tucked into the hub

const ANGLES = [0, 72, 144, 216, 288];

/**
 * Hub radius. The reference photo's hub is about 22% of the propeller's
 * diameter; at a tip radius of 86 that is 19-20 here. An earlier 27 made the
 * hub the subject and the blades an afterthought.
 */
const HUB_R = 20;

/** Where each blade's retention collar sits, straddling the blade root. */
const COLLAR_R = 80;

export function HeroFan() {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden
      className="h-[340px] w-[340px] animate-store-float drop-shadow-[0_34px_70px_rgba(0,0,0,0.6)] motion-reduce:animate-none"
    >
      <defs>
        {/* The photo's backlight — a cool halo behind the hub. */}
        <radialGradient id="hf-glow">
          <stop offset="0%" stopColor="#cfc6da" stopOpacity="0.30" />
          <stop offset="35%" stopColor="#8f93b4" stopOpacity="0.14" />
          <stop offset="70%" stopColor="#2b2f45" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>

        {/* Matte black, lit from the leading edge so the paddle reads as solid. */}
        <linearGradient id="hf-blade" x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0%" stopColor="#05070a" />
          <stop offset="42%" stopColor="#12161c" />
          <stop offset="72%" stopColor="#242a33" />
          <stop offset="100%" stopColor="#0b0e13" />
        </linearGradient>

        {/* Polished aluminium: hard bands rather than a smooth ramp, which is
            what makes a surface read as metal instead of plastic. */}
        <linearGradient id="hf-metal" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#e8ecf1" />
          <stop offset="22%" stopColor="#9aa4b1" />
          <stop offset="38%" stopColor="#d6dce3" />
          <stop offset="58%" stopColor="#6f7987" />
          <stop offset="78%" stopColor="#aab3bf" />
          <stop offset="100%" stopColor="#454d59" />
        </linearGradient>
        <linearGradient id="hf-metal2" x1="0.9" y1="0" x2="0.1" y2="1">
          <stop offset="0%" stopColor="#cdd4dc" />
          <stop offset="45%" stopColor="#79838f" />
          <stop offset="100%" stopColor="#39404a" />
        </linearGradient>
        <radialGradient id="hf-boss">
          <stop offset="0%" stopColor="#dfe4ea" />
          <stop offset="55%" stopColor="#8d97a3" />
          <stop offset="100%" stopColor="#3d434d" />
        </radialGradient>

        {/* The copper maker's decal. */}
        <linearGradient id="hf-decal" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#e08a4e" />
          <stop offset="55%" stopColor="#b85c26" />
          <stop offset="100%" stopColor="#7d3a14" />
        </linearGradient>

        {/* Markings are painted ON the blade, so they get clipped to it. The
            clip is in blade-local space, so one definition serves all five. */}
        <clipPath id="hf-clip">
          <path d={BLADE} />
        </clipPath>
      </defs>

      {/* Backlight. Outside the rotor: a light behind the prop does not spin. */}
      <circle cx="100" cy="100" r="100" fill="url(#hf-glow)" />

      <g className="origin-center animate-[spin_7s_linear_infinite] motion-reduce:animate-none">
        {/* Hub barrel and the collar each blade root seats into. */}
        <circle cx="100" cy="100" r={HUB_R} fill="url(#hf-metal)" stroke="#20252c" strokeWidth="0.8" />
        {ANGLES.map((a) => (
          <g key={`c${a}`} transform={`rotate(${a} 100 100)`}>
            <rect x="93.5" y={COLLAR_R - 7} width="13" height="15" rx="3.5" fill="url(#hf-metal2)" stroke="#232830" strokeWidth="0.7" />
            <rect x="95.8" y={COLLAR_R - 4.5} width="8.4" height="10" rx="2.2" fill="#333a44" opacity="0.6" />
          </g>
        ))}

        {/* Blades, each with its own painted markings. */}
        {ANGLES.map((a) => (
          <g key={`b${a}`} transform={`rotate(${a} 100 100)`}>
            <path d={BLADE} fill="url(#hf-blade)" stroke="#39424f" strokeWidth="0.5" strokeLinejoin="round" />
            <g clipPath="url(#hf-clip)">
              {/* Twin tip bands. */}
              <rect x="80" y="16.6" width="40" height="3.6" fill="#f2f5f8" opacity="0.93" />
              <rect x="80" y="23" width="40" height="3.6" fill="#f2f5f8" opacity="0.93" />
              {/* Maker's decal, and the small painted index mark below it. */}
              <ellipse cx="100" cy="47" rx="2.5" ry="4" fill="url(#hf-decal)" />
              <ellipse cx="100" cy="47" rx="2.5" ry="4" fill="none" stroke="#f0d3b8" strokeWidth="0.35" opacity="0.5" />
              <rect x="98.9" y="60" width="2.2" height="4.4" rx="0.7" fill="#e8edf2" opacity="0.85" />
            </g>
          </g>
        ))}

        {/* Centre boss, its bolt circle, and the spinner cap. */}
        <circle cx="100" cy="100" r="12" fill="url(#hf-metal2)" stroke="#232830" strokeWidth="0.7" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <circle
            key={`bolt${a}`}
            cx={100 + 8.6 * Math.cos((a * Math.PI) / 180)}
            cy={100 + 8.6 * Math.sin((a * Math.PI) / 180)}
            r="1.15"
            fill="#4c545f"
            stroke="#cfd6de"
            strokeWidth="0.35"
          />
        ))}
        <circle cx="100" cy="100" r="6" fill="url(#hf-boss)" stroke="#242a32" strokeWidth="0.6" />
        <circle cx="100" cy="100" r="2.4" fill="#1c2129" />
      </g>
    </svg>
  );
}
