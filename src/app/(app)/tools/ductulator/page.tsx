import { Ductulator } from "./ductulator";

export default function DuctulatorPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Size round &amp; rectangular galvanized duct from an airflow and a target friction rate or
        velocity (standard air).
      </p>
      <Ductulator />
    </div>
  );
}
