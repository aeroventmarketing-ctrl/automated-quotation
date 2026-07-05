import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizeCompany, normalizePerson, normalizeEmail, phoneKey } from "@/lib/client-ownership";

export const dynamic = "force-dynamic";

type ByKey = "company" | "person" | "phone" | "email";

const FIELDS: { key: ByKey; label: string; get: (c: CustomerRow) => string | null; norm: (v: string | null) => string }[] = [
  { key: "company", label: "Company name", get: (c) => c.company, norm: normalizeCompany },
  { key: "person", label: "Contact person", get: (c) => c.contactName, norm: normalizePerson },
  { key: "phone", label: "Contact number", get: (c) => c.phone, norm: phoneKey },
  { key: "email", label: "Email address", get: (c) => c.email, norm: normalizeEmail },
];

type CustomerRow = {
  id: string;
  company: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  _count: { inquiries: number };
};

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const by: ByKey = (["company", "person", "phone", "email"] as const).includes(sp.by as ByKey)
    ? (sp.by as ByKey)
    : "company";
  const q = (sp.q ?? "").trim().toLowerCase();

  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      company: true,
      contactName: true,
      email: true,
      phone: true,
      _count: { select: { inquiries: true } },
    },
    orderBy: { company: "asc" },
  });

  const field = FIELDS.find((f) => f.key === by)!;

  // Group customers by the normalized value of the chosen field; keep only
  // groups where the same value appears on 2+ different customer records.
  const groups = new Map<string, { display: string; rows: CustomerRow[] }>();
  for (const c of customers) {
    const raw = field.get(c);
    const key = field.norm(raw);
    if (!key) continue; // blank field never counts as a duplicate
    const g = groups.get(key) ?? { display: (raw ?? "").trim(), rows: [] };
    g.rows.push(c);
    groups.set(key, g);
  }
  let dupGroups = [...groups.values()]
    .filter((g) => g.rows.length > 1)
    .sort((a, b) => b.rows.length - a.rows.length || a.display.localeCompare(b.display));

  if (q) {
    dupGroups = dupGroups.filter(
      (g) =>
        g.display.toLowerCase().includes(q) ||
        g.rows.some(
          (r) =>
            r.company.toLowerCase().includes(q) ||
            (r.contactName ?? "").toLowerCase().includes(q) ||
            (r.email ?? "").toLowerCase().includes(q) ||
            (r.phone ?? "").toLowerCase().includes(q),
        ),
    );
  }

  const dupCount = dupGroups.reduce((a, g) => a + g.rows.length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Duplicate clients</h2>
        <p className="text-sm text-muted-foreground">
          Find client records that share the same detail, so duplicates can be reviewed and cleaned up. Matching
          ignores case, spacing and punctuation; phone numbers match on their last 10 digits.
        </p>
      </div>

      {/* Field selector */}
      <div className="flex flex-wrap gap-2">
        {FIELDS.map((f) => (
          <Link
            key={f.key}
            href={{ pathname: "/admin/duplicates", query: { by: f.key, ...(q ? { q } : {}) } }}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              f.key === by ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
            }`}
          >
            Duplicate {f.label.toLowerCase()}
          </Link>
        ))}
      </div>

      {/* Search within the current field's duplicates */}
      <form method="GET" className="flex gap-2">
        <input type="hidden" name="by" value={by} />
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Filter by any letters…"
          className="flex h-9 w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button type="submit" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          Search
        </button>
        {q && (
          <Link
            href={{ pathname: "/admin/duplicates", query: { by } }}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Clear
          </Link>
        )}
      </form>

      <p className="text-sm text-muted-foreground">
        {dupGroups.length === 0
          ? `No duplicate ${field.label.toLowerCase()} found.`
          : `${dupGroups.length} duplicate ${field.label.toLowerCase()} ${dupGroups.length === 1 ? "value" : "values"} across ${dupCount} client records.`}
      </p>

      <div className="space-y-3">
        {dupGroups.map((g) => (
          <Card key={g.display || "—"}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {field.label}: <span className="font-bold">{g.display || "—"}</span>{" "}
                <span className="font-normal text-muted-foreground">· {g.rows.length} records</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {g.rows.map((r) => (
                <Link
                  key={r.id}
                  href={`/customers/${r.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border p-2 text-sm hover:bg-accent"
                >
                  <span className="font-medium">{r.company}</span>
                  <span className="text-muted-foreground">{r.contactName || "—"}</span>
                  <span className="text-muted-foreground">{r.email || "—"}</span>
                  <span className="text-muted-foreground">{r.phone || "—"}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r._count.inquiries} inquir{r._count.inquiries === 1 ? "y" : "ies"}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
