import { PulleyCalculator } from "./pulley-calculator";

export default function PulleyPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Belt-drive sheave sizing — enter any three of motor RPM, motor pulley, fan pulley, and fan
        RPM to solve the fourth, plus the drive ratio and belt speed.
      </p>
      <PulleyCalculator />
    </div>
  );
}
