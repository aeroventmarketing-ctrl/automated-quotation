import { SmokeExhaustCalculator } from "./smoke-exhaust-calculator";

export default function SmokeExhaustPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Size smoke exhaust fans: for an atrium or mall from the design fire&apos;s smoke plume, or for a car park or
        basement from air changes.
      </p>
      <SmokeExhaustCalculator />
    </div>
  );
}
