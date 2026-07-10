import { DuctSheetCalculator } from "./duct-sheet-calculator";

export default function DuctSheetsPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Estimate how many sheets a duct piece consumes from its developed (flat-pattern) area.
        The material sets the joining method — Galvanized Iron uses the lockformer + TDF flanged
        forming; Black Iron &amp; Stainless are welded — which sets the seam allowance.
      </p>
      <DuctSheetCalculator />
    </div>
  );
}
