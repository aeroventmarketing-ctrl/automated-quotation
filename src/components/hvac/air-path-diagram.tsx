/**
 * Where to put the instrument: entering air and leaving air, on one air path.
 *
 * The owner, looking at the Air Heat tool on a phone: *"How do I measure leaving
 * air and entering air. Make a graphical representation for proper
 * understanding."* The two boxes on the form assume you already know which side
 * of the coil each reading comes from, and that assumption is exactly what a
 * calculator cannot state in a field label.
 *
 * What the picture has to show, and why each part earns its place:
 *
 *  - **The coil is the boundary.** Entering is whatever reaches its face,
 *    leaving is whatever comes off it. Everything else on the drawing exists to
 *    say where that face is.
 *  - **Outside air changes the entering condition.** A system that mixes fresh
 *    air has an on-coil state that is neither the room nor the outside, and
 *    reading the room thermostat instead is the commonest way to get the
 *    entering air wrong.
 *  - **The fan is downstream, and it heats.** Measuring at the supply grille
 *    reads 1–3 °F warmer than off-coil, plus whatever the duct picked up. That
 *    is a real number — it just is not the one this calculator asks for. It is
 *    marked with a cross rather than left out, because the mistake is invisible
 *    unless you are told it exists.
 *
 * Drawn in `currentColor` so it inherits the text colour of wherever it sits.
 * That is what lets the staff tool's card and the storefront's very different
 * palette share one drawing instead of keeping two in step.
 *
 * The `dark:` accents are forward-looking, not active: this app defines its
 * tokens in a single `:root` block with no `.dark` override and nothing ever
 * sets the class, so it is light-only today. Using `currentColor` for the line
 * work means the diagram would follow a dark theme the day one arrives, without
 * anyone having to remember this file exists.
 */

const ACCENT = "text-emerald-600 dark:text-emerald-400";
const WARN = "text-amber-600 dark:text-amber-500";

export function AirPathDiagram({ className = "" }: { className?: string }) {
  return (
    // The drawing is wider than a phone. Rather than shrink the lettering until
    // nobody can read it, it scrolls sideways — the same thing the wide tables
    // in this app do.
    <div className={`overflow-x-auto ${className}`}>
      <svg viewBox="0 0 760 348" role="img" aria-labelledby="air-path-title air-path-desc" className="w-full min-w-[640px]">
        <title id="air-path-title">Where to measure entering and leaving air</title>
        <desc id="air-path-desc">
          Air flows from the space, mixes with any outside air, passes the coil, then the fan, then back to the space.
          Entering air is measured at the coil face before the coil; leaving air immediately after the coil and before
          the fan. Measuring at the supply grille instead includes the heat the fan adds.
        </desc>

        <defs>
          <marker id="ap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* ---- the duct run ------------------------------------------------ */}
        <g stroke="currentColor" fill="none" strokeOpacity="0.35" strokeWidth="2">
          <path d="M95 145 H660" />
          <path d="M95 195 H660" />
        </g>

        {/* air direction */}
        <g stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" markerEnd="url(#ap-arrow)" color="currentColor">
          <path d="M108 170 H150" />
          <path d="M480 170 H545" />
        </g>

        {/* from / to the space */}
        <g fill="currentColor" fontSize="13" fontWeight="600" fillOpacity="0.65">
          <text x="8" y="166">FROM THE</text>
          <text x="8" y="182">SPACE</text>
          <text x="672" y="166">TO THE</text>
          <text x="672" y="182">SPACE</text>
        </g>

        {/* ---- outside air, if any ----------------------------------------- */}
        <g stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" strokeDasharray="5 4" fill="none" markerEnd="url(#ap-arrow)" color="currentColor">
          <path d="M175 92 V143" />
        </g>
        <g fill="currentColor" fontSize="13" fillOpacity="0.6">
          <text x="190" y="80">Outside air, if the system mixes any —</text>
          <text x="190" y="96">this is why the room is not the entering air</text>
        </g>

        {/* ---- the coil ----------------------------------------------------- */}
        <rect x="243" y="145" width="62" height="50" fill="currentColor" fillOpacity="0.07" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" />
        <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5">
          <path d="M255 145 V195 M267 145 V195 M279 145 V195 M291 145 V195" />
        </g>
        <text x="274" y="217" textAnchor="middle" fill="currentColor" fontSize="13" fontWeight="700" fillOpacity="0.7">COIL</text>

        {/* ---- the fan ------------------------------------------------------ */}
        <circle cx="400" cy="170" r="26" fill="currentColor" fillOpacity="0.07" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" />
        {/* Three blades on a hub. The first attempt drew them as loose curves and
            came out looking like a keyhole; a wedge repeated at 120° reads as an
            impeller at any size. */}
        <g fill="currentColor" fillOpacity="0.3" stroke="none">
          {[0, 120, 240].map((deg) => (
            <path key={deg} transform={`rotate(${deg} 400 170)`} d="M400 170 L396 149 A21 21 0 0 1 414 157 Z" />
          ))}
        </g>
        <circle cx="400" cy="170" r="4.5" fill="currentColor" fillOpacity="0.55" stroke="none" />
        <text x="400" y="217" textAnchor="middle" fill="currentColor" fontSize="13" fontWeight="700" fillOpacity="0.7">FAN</text>

        {/* ---- supply grille ------------------------------------------------ */}
        <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="2">
          <path d="M645 145 V195 M652 148 V192 M659 152 V188" />
        </g>

        {/* ---- 1 · entering air, below ------------------------------------- */}
        <g className={ACCENT}>
          <circle cx="222" cy="170" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <text x="222" y="174.5" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="700">1</text>
          <path d="M222 179 V268" stroke="currentColor" strokeWidth="2" fill="none" />
          <text x="150" y="292" fill="currentColor" fontSize="15" fontWeight="700">1 · ENTERING AIR — on-coil</text>
          <text x="150" y="312" fill="currentColor" fontSize="13" fillOpacity="0.85">
            Dry bulb + RH in the airstream at the coil face,
          </text>
          <text x="150" y="329" fill="currentColor" fontSize="13" fillOpacity="0.85">
            after any outside air has mixed in.
          </text>
        </g>

        {/* ---- 2 · leaving air, above --------------------------------------- */}
        <g className={ACCENT}>
          <circle cx="326" cy="170" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <text x="326" y="174.5" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="700">2</text>
          <path d="M326 161.5 V126" stroke="currentColor" strokeWidth="2" fill="none" />
          <text x="344" y="116" fill="currentColor" fontSize="15" fontWeight="700">2 · LEAVING AIR — off-coil</text>
          <text x="344" y="136" fill="currentColor" fontSize="13" fillOpacity="0.85">
            Straight after the coil, BEFORE the fan.
          </text>
        </g>

        {/* ---- the trap ----------------------------------------------------- */}
        <g className={WARN}>
          <g stroke="currentColor" strokeWidth="2.5" fill="none">
            <path d="M604 163 l12 12 M616 163 l-12 12" />
          </g>
          <path d="M610 182 V240" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" fill="none" />
          <text x="530" y="262" fill="currentColor" fontSize="13" fontWeight="700">Not at the grille</text>
          <text x="530" y="279" fill="currentColor" fontSize="12" fillOpacity="0.9">
            the fan adds 1–3 °F, and
          </text>
          <text x="530" y="294" fill="currentColor" fontSize="12" fillOpacity="0.9">
            the duct adds more again
          </text>
        </g>

        {/* ---- ΔT ------------------------------------------------------------ */}
        <g stroke="currentColor" strokeOpacity="0.5" fill="none" strokeWidth="1.5">
          <path d="M222 228 V240 H326 V228" />
        </g>
        <text x="274" y="258" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="700" fillOpacity="0.8">
          ΔT
        </text>
      </svg>
    </div>
  );
}

/**
 * The words that go with the picture — the practical half of the owner's
 * question, kept beside it so the two are read together.
 */
export const AIR_MEASUREMENT_NOTES: { title: string; body: string }[] = [
  {
    title: "Sensible heat needs only the two temperatures",
    body:
      "Humidity is optional. Leave both RH boxes empty and you get the sensible heat, which is all the airflow sizing needs.",
  },
  {
    title: "Probe in the airstream, not against the metal",
    body:
      "A tip touching the duct wall reads the duct, not the air. Put it near the centre of the flow and give it 60–90 seconds to settle.",
  },
  {
    title: "Take several readings across the duct",
    body:
      "Air leaving a coil is not the same temperature everywhere — the face is rarely loaded evenly. Read at four or five points across the section and average them.",
  },
  {
    title: "One instrument for both points",
    body:
      "Using the same meter at 1 and 2 cancels its calibration error, and it is the DIFFERENCE this calculator works from.",
  },
  {
    title: "Let the system settle first",
    body:
      "Fifteen minutes of steady running. Readings taken at start-up, or during a defrost, describe neither condition.",
  },
  {
    title: "A wet coil should read 90–95% RH off-coil",
    body:
      "That is the sanity check. If a coil that is visibly condensing reads much drier than that, the probe is wrong or it is in the wrong place — and a sensor wet with carry-over condensate will stick at 100%.",
  },
];
