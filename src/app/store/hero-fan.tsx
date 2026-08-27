/**
 * The hero's fan artwork — the six-blade blue axial impeller from the owner's
 * photo, drawn as SVG so it stays crisp at any size and costs no image request.
 * Shown when no flagship hero photo is set.
 *
 * The blade is reproduced as it is in that photo, not restyled: a flat stamped
 * paddle of near-constant width with generously rounded corners, carried on a
 * short narrow neck off a six-arm spider plate, with a plain domed hub over the
 * middle. Adjacent blades do not touch — the photo has real daylight between
 * them, and closing those gaps would be a different fan.
 *
 * Each paddle is PITCHED: rotated about its own centre, which is what a flat
 * blade must be to move air, and what gives the photo its leaning, pinwheel
 * look. Everything else — the paddle outline, the neck, the spider, the hub —
 * is drawn flat, exactly as it reads in the photo.
 *
 * Only the impeller turns; nothing else moves.
 */

/** Six blades, evenly spaced — the photo's arrangement. */
const ANGLES = [0, 60, 120, 180, 240, 300];

/** The domed hub over the middle of the spider. */
const HUB_R = 19;

/**
 * How far each paddle is rotated about its own centre. Zero would draw a flat
 * daisy of rectangles; this is the pitch, and it is what makes the artwork read
 * as a fan rather than a badge.
 */
const PITCH = 21;

/** The paddle's centre, which is also what it pitches about. */
const PADDLE_CX = 100;
const PADDLE_CY = 38;

/** The paddle: a flat stamped rectangle, corners well rounded. */
const PADDLE = { x: 86, y: 6, w: 28, h: 64, rx: 8 };

export function HeroFan() {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden
      className="h-[340px] w-[340px] animate-store-float drop-shadow-[0_30px_60px_rgba(0,0,0,0.55)] motion-reduce:animate-none"
    >
      <defs>
        {/* Painted sheet steel, lit from one edge and deepening across the face. */}
        <linearGradient id="hf-blade" x1="0" y1="0" x2="1" y2="0.22">
          <stop offset="0%" stopColor="#5CC3E4" />
          <stop offset="26%" stopColor="#31A8D6" />
          <stop offset="68%" stopColor="#2094C4" />
          <stop offset="100%" stopColor="#12719A" />
        </linearGradient>

        {/* The bright specular streak the photo has down each paddle. */}
        <linearGradient id="hf-spec" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="30%" stopColor="#ffffff" stopOpacity="0.46" />
          <stop offset="47%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        {/* The neck and the spider arms sit in shadow under the blades. */}
        <linearGradient id="hf-neck" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3BAAD2" />
          <stop offset="55%" stopColor="#2290BC" />
          <stop offset="100%" stopColor="#136C92" />
        </linearGradient>

        {/* The hub is domed, so its highlight sits up and to the left. */}
        <radialGradient id="hf-hub" cx="0.35" cy="0.3" r="0.82">
          <stop offset="0%" stopColor="#8FDCF2" />
          <stop offset="34%" stopColor="#46B4DA" />
          <stop offset="74%" stopColor="#2091BD" />
          <stop offset="100%" stopColor="#0F6689" />
        </radialGradient>
      </defs>

      <g className="origin-center animate-[spin_7s_linear_infinite_reverse] motion-reduce:animate-none">
        {/* The spider: six arms reaching out from under the hub to each neck. */}
        {ANGLES.map((a) => (
          <g key={`s${a}`} transform={`rotate(${a} 100 100)`}>
            <path
              d="M 94.5 100 L 95.5 70 Q 100 67 104.5 70 L 105.5 100 Z"
              fill="url(#hf-neck)"
              stroke="#0E6488"
              strokeWidth="0.5"
              strokeLinejoin="round"
            />
          </g>
        ))}

        {/* The blades. */}
        {ANGLES.map((a) => (
          <g key={`b${a}`} transform={`rotate(${a} 100 100)`}>
            <g transform={`rotate(${PITCH} ${PADDLE_CX} ${PADDLE_CY})`}>
              <rect
                x={PADDLE.x}
                y={PADDLE.y}
                width={PADDLE.w}
                height={PADDLE.h}
                rx={PADDLE.rx}
                fill="url(#hf-blade)"
                stroke="#0E6488"
                strokeWidth="0.6"
              />
              <rect
                x={PADDLE.x}
                y={PADDLE.y}
                width={PADDLE.w}
                height={PADDLE.h}
                rx={PADDLE.rx}
                fill="url(#hf-spec)"
              />
            </g>
          </g>
        ))}

        {/* The domed hub, over the spider and the blade roots. */}
        <circle cx="100" cy="100" r={HUB_R} fill="url(#hf-hub)" stroke="#0E6488" strokeWidth="0.8" />
        <circle cx="100" cy="100" r="7" fill="#2A97BE" opacity="0.45" />
      </g>
    </svg>
  );
}
