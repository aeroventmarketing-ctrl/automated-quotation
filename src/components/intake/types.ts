export interface DraftParsed {
  description: string;
  airflow: number | null;
  airflowUnit: string | null;
  staticPressure: number | null;
  pressureUnit: string | null;
  qty: number | null;
  application: string | null;
  modelText: string | null;
  notes: string | null;
}

export interface DraftItem {
  rawText: string;
  qty: number;
  parsedJson: DraftParsed;
}

export function emptyParsed(): DraftParsed {
  return {
    description: "",
    airflow: null,
    airflowUnit: null,
    staticPressure: null,
    pressureUnit: null,
    qty: 1,
    application: null,
    modelText: null,
    notes: null,
  };
}

export function emptyDraft(): DraftItem {
  return { rawText: "", qty: 1, parsedJson: emptyParsed() };
}

export const AIRFLOW_UNITS = ["CFM", "m3/hr", "m3/s", "L/s"];
export const PRESSURE_UNITS = ["Pa", "mmAq", "inWG", "kPa"];
