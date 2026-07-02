"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { isNextControlFlowError } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { updateCustomer } from "../actions";

export interface CustomerDetails {
  id: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export function CustomerHeader({ customer }: { customer: CustomerDetails }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(customer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (p: Partial<CustomerDetails>) => setForm((f) => ({ ...f, ...p }));

  function startEdit() {
    setForm(customer);
    setError(null);
    setEditing(true);
  }

  async function onSave() {
    if (!form.company.trim()) {
      setError("Company is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateCustomer(customer.id, {
        company: form.company,
        contactName: form.contactName,
        email: form.email,
        phone: form.phone,
        address: form.address,
        notes: form.notes,
      });
      setEditing(false);
      router.refresh();
    } catch (e) {
      if (isNextControlFlowError(e)) throw e;
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{customer.company}</h1>
            <Button
              size="sm"
              variant="ghost"
              title="Edit client details"
              onClick={startEdit}
              className="h-8 w-8 p-0"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Client profile</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/quotations">← Back to quotations</Link>
        </Button>
      </div>

      {editing && (
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Company</Label>
              <Input value={form.company} onChange={(e) => set({ company: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Contact person</Label>
              <Input value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Contact number</Label>
              <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => set({ address: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button size="sm" onClick={onSave} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
              {error && <span className="text-sm text-destructive">{error}</span>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
