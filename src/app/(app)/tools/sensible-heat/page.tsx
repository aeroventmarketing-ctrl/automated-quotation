import { AirHeatCalculator } from "./air-heat-calculator";

export default function SensibleHeatPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Sensible, latent and total heat carried by an airflow, with the sensible heat ratio — corrected
        for altitude and air temperature.
      </p>
      <AirHeatCalculator />
    </div>
  );
}
