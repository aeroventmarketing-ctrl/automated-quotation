import { JobOrderTool } from "./job-order-tool";

export default function JobOrderToolPage() {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Build a Fans &amp; Blowers job order and print it — the same form used on an order, for
        ad-hoc use. Job orders here aren&apos;t saved; enter a JO number, fill the form, then View or
        Print.
      </p>
      <JobOrderTool />
    </div>
  );
}
