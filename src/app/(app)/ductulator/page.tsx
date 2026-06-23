import { Ductulator } from "./ductulator";

export default function DuctulatorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ductulator</h1>
        <p className="text-muted-foreground">
          Size round &amp; rectangular galvanized duct from an airflow and a target friction rate or
          velocity (standard air).
        </p>
      </div>
      <Ductulator />
    </div>
  );
}
