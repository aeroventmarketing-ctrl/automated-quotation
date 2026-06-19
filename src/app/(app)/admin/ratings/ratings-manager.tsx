"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteRatingPoint } from "../actions";

interface Point {
  id: string;
  rpm: number;
  airflow_m3hr: number;
  staticPressure_pa: number;
  power_kw: number;
  efficiency: number | null;
}
interface Model { modelCode: string; name: string; points: Point[] }

export function RatingsManager({ models }: { models: Model[] }) {
  const router = useRouter();

  async function remove(id: string) {
    if (!confirm("Delete this rating point?")) return;
    await deleteRatingPoint(id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Rating curves power the selection engine. Bulk-load via the <strong>Import CSV</strong> tab
        (type: ratings).
      </p>
      {models.length === 0 && <p className="text-sm">No rating points yet.</p>}
      {models.map((m) => (
        <Card key={m.modelCode}>
          <CardHeader><CardTitle className="text-base">{m.modelCode} — {m.name}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">RPM</TableHead>
                  <TableHead className="text-right">Airflow (m³/hr)</TableHead>
                  <TableHead className="text-right">SP (Pa)</TableHead>
                  <TableHead className="text-right">Power (kW)</TableHead>
                  <TableHead className="text-right">Eff.</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.points.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-right">{p.rpm}</TableCell>
                    <TableCell className="text-right">{p.airflow_m3hr}</TableCell>
                    <TableCell className="text-right">{p.staticPressure_pa}</TableCell>
                    <TableCell className="text-right">{p.power_kw}</TableCell>
                    <TableCell className="text-right">{p.efficiency != null ? `${Math.round(p.efficiency * 100)}%` : "—"}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => remove(p.id)}>Delete</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
