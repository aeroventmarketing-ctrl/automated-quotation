import { AirHeatCalculator } from "./air-heat-calculator";

export default function SensibleHeatPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        The heat an airflow carries — or the airflow a load needs. Sensible, latent and total with the
        sensible heat ratio, corrected for altitude and air temperature.
      </p>
      <AirHeatCalculator />
    </div>
  );
}
