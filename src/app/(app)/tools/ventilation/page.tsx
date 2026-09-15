import { VentilationCalculator } from "./ventilation-calculator";

export default function VentilationPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Size an exhaust or ventilation fan: the airflow the heat gain needs, the airflow the occupancy
        needs, and which of the two governs.
      </p>
      <VentilationCalculator />
    </div>
  );
}
