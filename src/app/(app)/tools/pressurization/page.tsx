import { PressurizationCalculator } from "./pressurization-calculator";

export default function PressurizationPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Size a stair pressurization fan, floor by floor: the airflow the doors leak and the open door needs, and
        every floor&apos;s pressure checked against the minimum and the door-opening force.
      </p>
      <PressurizationCalculator />
    </div>
  );
}
