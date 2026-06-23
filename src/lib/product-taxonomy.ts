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
      "Backward Curved"
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
    "category": "Propeller Type",
    "type": "Panel Fan",
    "bladeTypes": [
      "Propeller",
      "Kidney"
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
      "Propeller"
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
  {
    "category": "Ventilation Accessories",
    "type": "Air Grille",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Ceiling Diffuser",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Louvers",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Bar Grille",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Fire Damper",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Gravity Shutter",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Backdraft Damper",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Smoke Damper",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Volume Damper",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Jet Nozzle Diffuser",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Vent Cap",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Spring Vibration Isolator",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Weaherhood",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Ventilation Accessories",
    "type": "Wind Driven Roof Ventilator",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Air Curtain",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Cabinet Fan",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Ceiling Cassette",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Compact Axial Flow Fan",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Duct Canvass Connector",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Dust Collector",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Jet Fan",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Mini Sirocco",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Motor Controller",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Poultry Fan",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Induction Motor",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "Variable Air Volume",
    "bladeTypes": [],
    "drives": []
  },
  {
    "category": "Other Products",
    "type": "VFD",
    "bladeTypes": [],
    "drives": []
  }
];

export const PRODUCT_CATEGORIES: string[] = Array.from(
  new Set(PRODUCT_TAXONOMY.map((e) => e.category)),
);

export function typesFor(category: string): string[] {
  return Array.from(
    new Set(PRODUCT_TAXONOMY.filter((e) => e.category === category).map((e) => e.type)),
  );
}

export function entryFor(category: string, type: string): TaxonomyEntry | undefined {
  return PRODUCT_TAXONOMY.find((e) => e.category === category && e.type === type);
}
