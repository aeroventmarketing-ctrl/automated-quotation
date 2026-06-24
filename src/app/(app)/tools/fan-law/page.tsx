import { FanLawCalculator } from "./fan-law-calculator";

export default function FanLawPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Fan affinity laws — scale a known operating point to a new speed (or target airflow /
        pressure): airflow ∝ speed, pressure ∝ speed², power ∝ speed³.
      </p>
      <FanLawCalculator />
    </div>
  );
}
