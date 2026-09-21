import { MoistureCalculator } from "./moisture-calculator";

export default function MoisturePage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Moisture Removal Analysis: how much water has to come out of the air, in litres a day — and
        whether a fan could do it instead of a machine.
      </p>
      <MoistureCalculator />
    </div>
  );
}
