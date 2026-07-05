/**
 * Product selection taxonomy (AFBM): Product Category -> Type -> Blade Type -> Drive.
 * Used by the cascading product classifier in the quotation. Source:
 * "Workflow_request.xlsx" (rows merged per Category+Type). Some branches have no
 * blade/drive options yet.
 */
export interface TaxonomyEntry {
  category: string;
  type: string;
  bladeTypes: string[];
  drives: string[];
  /** Optional make/brand level (e.g. "KDK") shown between Category and Type. */
  brand?: string;
  /** Optional series level (e.g. "Shutter Series") shown after Type. */
  series?: string[];
  /** Optional group level (e.g. "Air Terminals" / "Dampers") shown before Type. */
  group?: string;
}

export const PRODUCT_TAXONOMY: TaxonomyEntry[] = [
  {
    "category": "Centrifugal Type",
    "type": "Centrifugal Blower (SISW)",
    "bladeTypes": [
      "Backwardly Inclined",
      "Backward Curved",
      "Forward Curved"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "Centrifugal Blower (DIDW)",
    "bladeTypes": [
      "Backwardly Inclined",
      "Backward Curved",
      "Forward Curved"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "Centrifugal Inline Blower",
    "bladeTypes": [
      "Backwardly Inclined"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "Square Inline Blower",
    "bladeTypes": [
      "Backwardly Inclined"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "Cabinet Blower (SISW)",
    "bladeTypes": [
      "Backwardly Inlined",
      "Backward Curved",
      "Forward Curved"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "Cabinet Blower (DIDW)",
    "bladeTypes": [
      "Backwardly Inlined",
      "Backward Curved",
      "Forward Curved"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "High Pressure Blower",
    "bladeTypes": [
      "Backward Curved"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "Radial Blower",
    "bladeTypes": [
      "Paddle Wheel",
      "Ring Paddle Wheel",
      "Backplate Paddel Wheel"
    ],
    "drives": [
      "Direct Drive"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "Turbo Pressure Blower",
    "bladeTypes": [
      "Radial Wheel"
    ],
    "drives": [
      "Direct Drive"
    ]
  },
  {
    "category": "Centrifugal Type",
    "type": "Plug Fan",
    "bladeTypes": [
      "Backward Curved"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Axial Type",
    "type": "Tubeaxial",
    "bladeTypes": [
      "Axial"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Axial Type",
    "type": "Vaneaxial",
    "bladeTypes": [
      "Axial"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Axial Type",
    "type": "Customized Jet Fan",
    "bladeTypes": [
      "Axial"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Propeller Type",
    "type": "Exhaust Wall Fan",
    "bladeTypes": [
      "Propeller",
      "Reversible Blade"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Propeller Type",
    "type": "Fresh Air Wall Fan",
    "bladeTypes": [
      "Propeller",
      "Reversible Blade"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Propeller Type",
    "type": "Power Roof Ventilator",
    "bladeTypes": [
      "Propeller",
      "Reversible Blade"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Tubular Inline Type",
    "type": "Tubeaxial",
    "bladeTypes": [
      "Axial"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Tubular Inline Type",
    "type": "Vaneaxial",
    "bladeTypes": [
      "Axial"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Tubular Inline Type",
    "type": "Centrifugal Inline Blower",
    "bladeTypes": [
      "Backwardly Inclined"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Tubular Inline Type",
    "type": "Square Inline Blower",
    "bladeTypes": [
      "Backwardly Inclined"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Cabinet Type",
    "type": "Cabinet Blower (SISW)",
    "bladeTypes": [
      "Backwardly Inclined",
      "Backward Curved"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  {
    "category": "Cabinet Type",
    "type": "Cabinet Blower (DIDW)",
    "bladeTypes": [
      "Backwardly Inlined",
      "Backward Curved",
      "Forward Curved"
    ],
    "drives": [
      "Belt",
      "Direct"
    ]
  },
  // Air Terminals
  { "category": "Ventilation Accessories", "group": "Air Terminals", "type": "Air Grille", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Air Terminals", "type": "Bar Grille", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Air Terminals", "type": "Ceiling Diffuser", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Air Terminals", "type": "Jet Nozzle Diffuser", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Air Terminals", "type": "Louvers", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Air Terminals", "type": "Perforated Air Grille", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Air Terminals", "type": "Vent Cap", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Air Terminals", "type": "Weather hood", "bladeTypes": [], "drives": [] },
  // Dampers
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Backdraft Damper", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Fire Damper", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Gravity Shutter", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Motorized Fire Damper", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Motorized Relief Damper", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Motorized Smoke Damper", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Motorized Volume Damper", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "OBVD", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Pressure Relief Damper", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Smoke Damper", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Dampers", "type": "Volume Damper", "bladeTypes": [], "drives": [] },
  // Accessories
  { "category": "Ventilation Accessories", "group": "Accessories", "type": "C-clip", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Accessories", "type": "Duct Angle corner", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Accessories", "type": "S-clip", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Accessories", "type": "Spring Vibration Isolator", "bladeTypes": [], "drives": [] },
  { "category": "Ventilation Accessories", "group": "Accessories", "type": "TDC Cleat", "bladeTypes": [], "drives": [] },
  {
    "category": "Other Products",
    "type": "Ceiling Cassette",
    "brand": "KDK",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Mini Sirocco",
    "brand": "KDK",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Cabinet Fan",
    "brand": "KDK",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Air Curtain",
    "brand": "KDK",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Wall Mounted Fan",
    "brand": "KDK",
    "series": ["Shutter Series", "High Pressure Series"],
    "bladeTypes": [],
    "drives": []
  },
  { "category": "Other Products", "brand": "Aerovent", "type": "Aluminum Duct", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Dust Collector", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Induction Motor (TECO)", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Induction Motor (Hyundai)", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Inline Duct Fan", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Jet Fan", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Motor Controller", "series": ["Motor Starter", "Variable Frequency Drive"], "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Portable Axial Blower", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Portable Axial Blower (XProof)", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Variable Air Volume", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "Aerovent", "type": "Wind Driven Roof Ventilator", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "AlphaAir", "type": "Ceiling Cassette", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "AlphaAir", "type": "Duct Canvass Connector", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "AlphaAir", "type": "HVLS", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "AlphaAir", "type": "Jet Fan", "bladeTypes": [], "drives": [] },
  { "category": "Other Products", "brand": "AlphaAir", "type": "Poultry Fan", "bladeTypes": [], "drives": [] }
];

export const PRODUCT_CATEGORIES: string[] = Array.from(
  new Set(PRODUCT_TAXONOMY.map((e) => e.category)),
);

/** Default brand bucket for entries in a branded category that have no brand. */
export const DEFAULT_BRAND = "Aerovent";

/** Preferred brand display order per category (brands not listed fall to the end). */
const BRAND_ORDER: Record<string, string[]> = {
  "Other Products": ["Aerovent", "AlphaAir", "KDK"],
};

/**
 * Brands (makes) offered in a category — only when at least one entry carries a
 * brand. Entries without a brand fall under DEFAULT_BRAND, so the category still
 * exposes all its types via a brand level. Empty when the category isn't branded.
 * Ordered by BRAND_ORDER when defined, else by first appearance.
 */
export function brandsFor(category: string): string[] {
  const entries = PRODUCT_TAXONOMY.filter((e) => e.category === category);
  if (!entries.some((e) => e.brand)) return [];
  const brands = Array.from(new Set(entries.map((e) => e.brand || DEFAULT_BRAND)));
  const order = BRAND_ORDER[category];
  if (order) {
    const rank = (b: string) => (order.indexOf(b) === -1 ? order.length : order.indexOf(b));
    brands.sort((a, b) => rank(a) - rank(b));
  }
  return brands;
}

/**
 * Groups (sub-categories) within a category — e.g. Ventilation Accessories →
 * Air Terminals / Dampers / Accessories. Empty when the category isn't grouped.
 * Order follows first appearance in the taxonomy.
 */
export function groupsFor(category: string): string[] {
  const entries = PRODUCT_TAXONOMY.filter((e) => e.category === category);
  if (!entries.some((e) => e.group)) return [];
  return Array.from(new Set(entries.map((e) => e.group).filter((g): g is string => !!g)));
}

/**
 * Types in a category, optionally filtered to one brand (branded categories) and
 * one group (grouped categories like Ventilation Accessories).
 */
export function typesFor(category: string, brand?: string, group?: string): string[] {
  return Array.from(
    new Set(
      PRODUCT_TAXONOMY.filter(
        (e) =>
          e.category === category &&
          (!brand || (e.brand || DEFAULT_BRAND) === brand) &&
          (!group || e.group === group),
      ).map((e) => e.type),
    ),
  );
}

/** The group a given type belongs to (empty string if the category isn't grouped). */
export function groupForType(category: string, type: string): string {
  return PRODUCT_TAXONOMY.find((e) => e.category === category && e.type === type)?.group ?? "";
}

export function entryFor(category: string, type: string): TaxonomyEntry | undefined {
  return PRODUCT_TAXONOMY.find((e) => e.category === category && e.type === type);
}

/** Categories where "Airfoil" is offered as an extra blade type (×1.5 body). */
const AIRFOIL_CATEGORIES = new Set([
  "Centrifugal Type",
  "Axial Type",
  "Tubular Inline Type",
  "Cabinet Type",
]);

/**
 * Blade-type options for a type, with "Airfoil" appended for the categories
 * that offer it (only when the type already has blade types).
 */
export function bladeTypesFor(category: string, type: string): string[] {
  const base = entryFor(category, type)?.bladeTypes ?? [];
  if (base.length > 0 && AIRFOIL_CATEGORIES.has(category) && !base.includes("Airfoil")) {
    return [...base, "Airfoil"];
  }
  return base;
}

/** Series options for a type (e.g. Wall Mounted Fan → Shutter / High Pressure). */
export function seriesFor(category: string, type: string): string[] {
  return entryFor(category, type)?.series ?? [];
}
