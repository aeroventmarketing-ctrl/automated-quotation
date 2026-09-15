/**
 * Where to put the instrument — for a fan with no duct.
 *
 * The owner asked first how entering and leaving air are measured, and the
 * answer that went up was a ducted air handler: room → coil → fan → supply. Then
 * they looked at it and said *"this one is better to be added into the tool, not
 * the previous image"*, pointing at the non-ducted version instead.
 *
 * They are right, and the reason is the business: Aerovent makes **fans and
 * blowers**, not air handlers. The customer standing in front of one of their
 * machines is almost always looking at a wall exhaust fan or a propeller fan on
 * an open opening — where there is no coil, and therefore no ΔT across the fan
 * at all. A coil diagram answers a question their customers rarely ask, and
 * quietly implies the tool is for something else.
 *
 * So the figure covers the three cases that actually turn up, and the first one
 * is the most important thing on it:
 *
 *  1. **A fan on its own moves air; it does not cool it.** ΔT ≈ 0. The only
 *     change across it is the motor's own heat, which is a RISE — about 2.4 °F
 *     per HP per 1,000 cfm. Feed that into the calculator and the answer you get
 *     back is the motor's shaft power restated in BTU, not a cooling load. Saying
 *     this plainly is the point of the whole drawing, because a calculator that
 *     accepts two numbers and returns a plausible figure will otherwise be used
 *     to size something.
 *  2. **An exhaust or ventilation fan: the ROOM is the boundary, not the fan.**
 *     The two readings sit on opposite sides of the building — outdoor make-up
 *     air in, room air out — and that IS the calculation worth doing.
 *  3. **A fan with a coil or heater blowing into open air.** Here there is a real
 *     ΔT, but the discharge is a free jet that entrains room air within a
 *     diameter or two, so the reading has to be taken in the core, close in.
 *
 * Unlike the duct drawing this replaced, the figure brings its own surface —
 * panels, borders and a fixed slate/emerald/amber palette — rather than
 * inheriting `currentColor`. A dense infographic reads better as a self-
 * contained plate, and it then looks identical on the staff card and on the
 * storefront's very different palette instead of shifting between them.
 */

export function AirPathDiagram({ className = "" }: { className?: string }) {
  return (
    // Wider than a phone, and deliberately so: shrinking this much lettering to
    // 400px would make it unreadable, which defeats the point. It scrolls
    // sideways instead — the same thing the wide tables in this app do.
    <div className={`overflow-x-auto ${className}`}>
      <svg
        viewBox="0 0 900 1412"
        role="img"
        aria-labelledby="ap-title ap-desc"
        className="w-full min-w-[760px]"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
      >
        <title id="ap-title">Measuring entering and leaving air on a fan with no duct</title>
        <desc id="ap-desc">
          Three cases. A fan on its own changes the air temperature only by its own motor heat, about 2.4 °F per
          horsepower per 1,000 cfm, so there is no cooling load to compute. For an exhaust or ventilation fan the
          boundary is the room: entering air is the outdoor make-up air at the louvre, leaving air is the room air at
          the fan inlet, and the heat removed is 1.08 × CFM × the temperature difference. For a fan with a coil or
          heater blowing into open air, measure at the intake grille and in the core of the discharge jet within one
          fan diameter, before room air mixes in.
        </desc>

        <defs>
          <marker id="ap-grey" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
          </marker>
          <marker id="ap-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#dc2626" />
          </marker>
        </defs>

        {/* ============ HEADER ============ */}
        <text x="40" y="46" fontSize="27" fontWeight="800" fill="#0f172a">Entering &amp; leaving air — with NO duct</text>
        <text x="40" y="72" fontSize="15" fill="#64748b">A fan has no coil, so the two readings are not taken across it.</text>
        <text x="40" y="92" fontSize="15" fill="#64748b">What you measure depends on what is actually changing the air.</text>
        <line x1="40" y1="108" x2="860" y2="108" stroke="#e2e8f0" strokeWidth="2" />

        {/* ============ 1 · FAN ALONE ============ */}
        <rect x="40" y="126" width="820" height="300" rx="10" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="2" />
        <text x="64" y="160" fontSize="19" fontWeight="800" fill="#0f172a">1 · A fan on its own</text>
        <text x="64" y="184" fontSize="14.5" fill="#64748b">Moving air, nothing heating or cooling it</text>

        <g stroke="#94a3b8" strokeWidth="3" fill="none" markerEnd="url(#ap-grey)">
          <path d="M78 268 H150" /><path d="M78 308 H150" /><path d="M78 348 H150" />
        </g>
        <circle cx="232" cy="308" r="62" fill="#ffffff" stroke="#475569" strokeWidth="3" />
        <g fill="#cbd5e1">
          {[0, 120, 240].map((deg) => (
            <path key={deg} transform={`rotate(${deg} 232 308)`} d="M232 308 L226 250 A58 58 0 0 1 276 272 Z" />
          ))}
        </g>
        <circle cx="232" cy="308" r="11" fill="#475569" />
        <path d="M232 370 V396 M196 396 H268" stroke="#475569" strokeWidth="3" fill="none" />
        <g stroke="#94a3b8" strokeWidth="3" fill="none" markerEnd="url(#ap-grey)">
          <path d="M314 268 H388" /><path d="M314 308 H388" /><path d="M314 348 H388" />
        </g>

        <g stroke="#059669" fill="#059669">
          <circle cx="150" cy="218" r="13" fill="none" strokeWidth="3" />
          <text x="150" y="224" fontSize="15" fontWeight="800" textAnchor="middle" stroke="none">1</text>
          <path d="M150 231 V250" strokeWidth="2.5" fill="none" />
          <circle cx="322" cy="218" r="13" fill="none" strokeWidth="3" />
          <text x="322" y="224" fontSize="15" fontWeight="800" textAnchor="middle" stroke="none">2</text>
          <path d="M322 231 V250" strokeWidth="2.5" fill="none" />
        </g>

        <rect x="424" y="206" width="412" height="196" rx="8" fill="#fff7ed" stroke="#fdba74" strokeWidth="2" />
        <text x="446" y="237" fontSize="17" fontWeight="800" fill="#b45309">ΔT ≈ 0 — there is nothing to compute</text>
        <text x="446" y="265" fontSize="14.5" fill="#7c2d12">A fan moves air. It does not cool it. The only</text>
        <text x="446" y="286" fontSize="14.5" fill="#7c2d12">temperature change across it is its own motor</text>
        <text x="446" y="307" fontSize="14.5" fill="#7c2d12">heat, and that is a rise, not a drop:</text>
        <text x="446" y="340" fontSize="16" fontWeight="700" fill="#b45309" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">ΔT ≈ 2.4 °F per HP per 1,000 cfm</text>
        <text x="446" y="370" fontSize="14" fill="#7c2d12">2 HP at 4,000 cfm → 1.2 °F. Put that in the</text>
        <text x="446" y="389" fontSize="14" fill="#7c2d12">calculator and you get the motor&apos;s heat back.</text>

        {/* ============ 2 · VENTILATION ============ */}
        <rect x="40" y="428" width="820" height="452" rx="10" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="2" />
        <text x="64" y="462" fontSize="19" fontWeight="800" fill="#0f172a">2 · An exhaust or ventilation fan — the ROOM is the boundary</text>
        <text x="64" y="486" fontSize="14.5" fill="#64748b">This is the calculation you actually want. The fan is not the boundary; the building is.</text>

        <rect x="150" y="514" width="392" height="240" rx="6" fill="#ffffff" stroke="#475569" strokeWidth="3" />
        <text x="346" y="542" fontSize="14" fontWeight="700" fill="#64748b" textAnchor="middle">INSIDE THE BUILDING</text>

        <g fill="#fecaca" stroke="#dc2626" strokeWidth="2">
          <rect x="214" y="662" width="56" height="44" rx="4" />
          <rect x="316" y="662" width="56" height="44" rx="4" />
          <rect x="418" y="662" width="56" height="44" rx="4" />
        </g>
        <g stroke="#dc2626" strokeWidth="2.5" fill="none" markerEnd="url(#ap-red)">
          <path d="M242 656 V616" /><path d="M344 656 V616" /><path d="M446 656 V616" />
        </g>
        <text x="346" y="732" fontSize="13.5" fill="#b91c1c" textAnchor="middle">machines · people · lights · roof gain</text>

        {/* louvre in the left wall */}
        <path d="M150 560 V620" stroke="#475569" strokeWidth="3" />
        <g stroke="#94a3b8" strokeWidth="2.5">
          <path d="M144 566 h12 M144 578 h12 M144 590 h12 M144 602 h12 M144 614 h12" />
        </g>
        <g stroke="#94a3b8" strokeWidth="3" fill="none" markerEnd="url(#ap-grey)">
          <path d="M78 590 H140" /><path d="M162 590 H226" />
        </g>
        <text x="64" y="632" fontSize="13.5" fontWeight="700" fill="#475569">louvre</text>

        {/* exhaust fan in the right wall */}
        <circle cx="542" cy="590" r="36" fill="#ffffff" stroke="#475569" strokeWidth="3" />
        <g fill="#cbd5e1">
          {[0, 120, 240].map((deg) => (
            <path key={deg} transform={`rotate(${deg} 542 590)`} d="M542 590 L538 557 A33 33 0 0 1 570 570 Z" />
          ))}
        </g>
        <circle cx="542" cy="590" r="7" fill="#475569" />
        <g stroke="#94a3b8" strokeWidth="3" fill="none" markerEnd="url(#ap-grey)">
          <path d="M586 590 H652" />
        </g>
        <text x="578" y="632" fontSize="13.5" fontWeight="700" fill="#475569">exhaust fan</text>

        <g stroke="#059669" fill="#059669">
          <circle cx="110" cy="524" r="13" fill="none" strokeWidth="3" />
          <text x="110" y="530" fontSize="15" fontWeight="800" textAnchor="middle" stroke="none">1</text>
          <path d="M110 537 V576" strokeWidth="2.5" fill="none" />
          <circle cx="498" cy="524" r="13" fill="none" strokeWidth="3" />
          <text x="498" y="530" fontSize="15" fontWeight="800" textAnchor="middle" stroke="none">2</text>
          <path d="M498 537 V572" strokeWidth="2.5" fill="none" />
        </g>

        <text x="64" y="784" fontSize="15.5" fontWeight="800" fill="#047857">1 · ENTERING — the make-up air</text>
        <text x="64" y="806" fontSize="13.5" fill="#0f766e">Outdoor air at the louvre or the open door,</text>
        <text x="64" y="825" fontSize="13.5" fill="#0f766e">in the incoming stream. Shade the probe —</text>
        <text x="64" y="844" fontSize="13.5" fill="#0f766e">sun on the tip reads hotter than the air.</text>

        <text x="392" y="784" fontSize="15.5" fontWeight="800" fill="#047857">2 · LEAVING — the room air</text>
        <text x="392" y="806" fontSize="13.5" fill="#0f766e">On the INLET side of the fan, in the room air</text>
        <text x="392" y="825" fontSize="13.5" fill="#0f766e">being drawn out — not in the discharge, and</text>
        <text x="392" y="844" fontSize="13.5" fill="#0f766e">not in the motor&apos;s warm plume.</text>

        <rect x="676" y="514" width="164" height="240" rx="8" fill="#ecfdf5" stroke="#6ee7b7" strokeWidth="2" />
        <text x="696" y="544" fontSize="14" fontWeight="800" fill="#047857">HEAT REMOVED</text>
        <g fontSize="14" fill="#065f46" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
          <text x="696" y="574">Qs = 1.08</text>
          <text x="696" y="594">   × CFM</text>
          <text x="696" y="614">   × (T₂ − T₁)</text>
        </g>
        <line x1="696" y1="632" x2="820" y2="632" stroke="#6ee7b7" strokeWidth="2" />
        <text x="696" y="656" fontSize="13" fill="#065f46">4,000 cfm</text>
        <text x="696" y="675" fontSize="13" fill="#065f46">room 95 °F</text>
        <text x="696" y="694" fontSize="13" fill="#065f46">outdoor 88 °F</text>
        <text x="696" y="722" fontSize="16" fontWeight="800" fill="#047857">30,240 BTU/hr</text>
        <text x="696" y="742" fontSize="13.5" fill="#065f46">= 2.5 tons removed</text>

        {/* ============ 3 · OPEN UNIT WITH A COIL ============ */}
        <rect x="40" y="900" width="820" height="330" rx="10" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="2" />
        <text x="64" y="934" fontSize="19" fontWeight="800" fill="#0f172a">3 · A fan WITH a coil or heater, blowing into open air</text>
        <text x="64" y="958" fontSize="14.5" fill="#64748b">Spot cooler, open unit heater, evaporative cooler — now there is a real ΔT to catch</text>

        {/* the jet first, so nothing sits on the lines */}
        <g stroke="#cbd5e1" strokeWidth="2.5" strokeDasharray="7 6" fill="none">
          <path d="M222 1000 L452 972" />
          <path d="M222 1120 L452 1148" />
        </g>

        <rect x="96" y="1000" width="126" height="120" rx="6" fill="#ffffff" stroke="#475569" strokeWidth="3" />
        <g stroke="#94a3b8" strokeWidth="2.5">
          <path d="M112 1012 V1108 M124 1012 V1108 M136 1012 V1108" />
        </g>
        <rect x="156" y="1012" width="26" height="96" fill="#e0f2fe" stroke="#0284c7" strokeWidth="2" />
        <g stroke="#94a3b8" strokeWidth="3" fill="none" markerEnd="url(#ap-grey)">
          <path d="M44 1060 H88" />
          <path d="M228 1060 H336" />
        </g>
        <text x="96" y="1142" fontSize="13" fontWeight="700" fill="#475569">fan + coil</text>

        <path d="M222 1166 V1178 H342 V1166" stroke="#475569" strokeWidth="1.5" fill="none" />
        <text x="282" y="1198" fontSize="12.5" fontWeight="700" fill="#475569" textAnchor="middle">one fan diameter</text>

        <g stroke="#059669" fill="#059669">
          <circle cx="66" cy="1015" r="13" fill="none" strokeWidth="3" />
          <text x="66" y="1021" fontSize="15" fontWeight="800" textAnchor="middle" stroke="none">1</text>
          <path d="M66 1028 V1048" strokeWidth="2.5" fill="none" />
          <circle cx="300" cy="1015" r="13" fill="none" strokeWidth="3" />
          <text x="300" y="1021" fontSize="15" fontWeight="800" textAnchor="middle" stroke="none">2</text>
          <path d="M300 1028 V1048" strokeWidth="2.5" fill="none" />
        </g>

        <text x="520" y="1010" fontSize="15.5" fontWeight="800" fill="#047857">1 · at the intake grille</text>
        <text x="520" y="1032" fontSize="13.5" fill="#0f766e">The room air the unit is drawing in.</text>
        <text x="520" y="1070" fontSize="15.5" fontWeight="800" fill="#047857">2 · in the core of the jet</text>
        <text x="520" y="1092" fontSize="13.5" fill="#0f766e">Within one fan diameter of the outlet,</text>
        <text x="520" y="1111" fontSize="13.5" fill="#0f766e">dead centre. Past that the jet has pulled</text>
        <text x="520" y="1130" fontSize="13.5" fill="#0f766e">room air in with it, and the reading drifts</text>
        <text x="520" y="1149" fontSize="13.5" fill="#0f766e">back toward room temperature.</text>
        <text x="520" y="1184" fontSize="12.5" fill="#94a3b8">(the dashed lines are the jet spreading)</text>

        {/* ============ FOOTER · the airflow ============ */}
        <rect x="40" y="1252" width="820" height="136" rx="10" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="2" />
        <text x="64" y="1282" fontSize="16.5" fontWeight="800" fill="#0f172a">And the airflow? With no duct there is nothing to traverse.</text>
        <text x="64" y="1308" fontSize="14" fill="#475569"><tspan fontWeight="700">Flow hood</tspan> over the grille — the direct reading, and the one to trust.</text>
        <text x="64" y="1329" fontSize="14" fill="#475569"><tspan fontWeight="700">Anemometer grid</tspan> across the fan face, averaged, × the free area.</text>
        <text x="64" y="1350" fontSize="14" fill="#475569"><tspan fontWeight="700">The fan curve</tspan>, at the static the fan is really working against — for a propeller</text>
        <text x="64" y="1371" fontSize="14" fill="#475569">fan on an open wall, near the free-delivery end.</text>
      </svg>
    </div>
  );
}

/**
 * Instrument technique, which the picture deliberately does not carry — the
 * figure says WHERE to stand, these say how to hold the thing once you are
 * there.
 */
export const AIR_MEASUREMENT_NOTES: { title: string; body: string }[] = [
  {
    title: "Sensible heat needs only the two temperatures",
    body:
      "Humidity is optional. Leave both RH boxes empty and you get the sensible heat, which is all a ventilation figure or an airflow sizing needs.",
  },
  {
    title: "Probe in the airstream, not against the metal",
    body:
      "A tip touching a wall or a guard reads the metal, not the air. Put it in the moving air and give it 60–90 seconds to settle.",
  },
  {
    title: "Take several readings and average them",
    body:
      "Air is not the same temperature everywhere across an opening — a louvre in the sun and a louvre in shade are different air. Read at four or five points.",
  },
  {
    title: "One instrument for both points",
    body:
      "Using the same meter at 1 and 2 cancels its calibration error, and it is the DIFFERENCE this calculator works from.",
  },
  {
    title: "Let the system settle first",
    body:
      "Fifteen minutes of steady running, doors in their normal position. A reading taken with the roller door just opened describes nothing.",
  },
  {
    title: "If there is a coil, it should read 90–95% RH off-coil",
    body:
      "That is the sanity check on a wet coil. Much drier and the probe is wrong or in the wrong place; a sensor wet with carry-over condensate sticks at 100%.",
  },
];
