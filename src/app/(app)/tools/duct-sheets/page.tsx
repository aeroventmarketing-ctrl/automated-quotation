import { DuctSheetCalculator } from "./duct-sheet-calculator";

export default function DuctSheetsPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Estimate how many 4&nbsp;ft&nbsp;×&nbsp;8&nbsp;ft sheets a duct consumes by nesting its flat
        blanks onto the sheet (both orientations), with an area estimate alongside. The material
        sets the joining method — Galvanized Iron uses the lockformer + TDF flanged forming; Black
        Iron &amp; Stainless are welded — which sets the seam allowance.
      </p>
      <DuctSheetCalculator />
    </div>
  );
}
