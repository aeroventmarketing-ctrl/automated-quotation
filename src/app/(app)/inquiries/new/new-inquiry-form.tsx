"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemRows } from "@/components/intake/item-rows";
import { AiExtractPanel } from "@/components/intake/ai-extract-panel";
import { emptyDraft, type DraftItem } from "@/components/intake/types";
import { isNextControlFlowError } from "@/lib/utils";
import { createInquiry } from "../actions";

const SOURCES = ["EMAIL", "PHONE", "WALK_IN", "PHOTO", "OTHER"] as const;

export function NewInquiryForm({ customers }: { customers: { id: string; company: string }[] }) {
  const [customerId, setCustomerId] = useState<string>("__new");
  const [customerSearch, setCustomerSearch] = useState("");
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("EMAIL");
  const [projectName, setProjectName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyDraft()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNewCustomer = customerId === "__new";

  const q = customerSearch.trim().toLowerCase();
  const filteredCustomers = q
    ? customers.filter((c) => c.company.toLowerCase().includes(q))
    : customers;
  // Keep the selected customer visible even if it falls outside the search.
  const selected = customers.find((c) => c.id === customerId);
  const listCustomers =
    selected && !filteredCustomers.some((c) => c.id === selected.id)
      ? [selected, ...filteredCustomers]
      : filteredCustomers;

  async function submit() {
    setError(null);
    if (isNewCustomer) {
      if (!company.trim()) {
        setError("Company is required.");
        return;
      }
      if (!contactName.trim()) {
        setError("Contact name is required.");
        return;
      }
      if (!email.trim() && !phone.trim()) {
        setError("Enter a contact number or an email address (at least one is required).");
        return;
      }
    }
    const cleanItems = items.filter((it) => it.rawText.trim() || it.parsedJson.description.trim());
    if (cleanItems.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    setSaving(true);
    try {
      await createInquiry({
        customerId: isNewCustomer ? undefined : customerId,
        company: isNewCustomer ? company : undefined,
        contactName: isNewCustomer ? contactName : undefined,
        email: isNewCustomer ? email : undefined,
        phone: isNewCustomer ? phone : undefined,
        source,
        projectName,
        notes,
        items: cleanItems.map((it) => ({
          rawText: it.rawText || it.parsedJson.description,
          qty: it.qty,
          parsedJson: it.parsedJson as unknown as Record<string, unknown>,
        })),
      });
      // createInquiry redirects on success.
    } catch (e) {
      if (isNextControlFlowError(e)) throw e; // let the redirect navigate
      setError(e instanceof Error ? e.message : "Failed to save inquiry");
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Customer</Label>
              <Input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search client by name…"
              />
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="__new">+ New customer…</option>
                {listCustomers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company}</option>
                ))}
              </Select>
              {q && listCustomers.length === 0 && (
                <p className="text-xs text-muted-foreground">No client matches “{customerSearch}”. Choose “+ New customer…” to add one.</p>
              )}
              {selected && (
                <Link
                  href={`/customers/${selected.id}`}
                  target="_blank"
                  className="inline-block text-xs font-medium text-primary hover:underline"
                >
                  View {selected.company} profile →
                </Link>
              )}
            </div>
            {isNewCustomer && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Company *</Label>
                  <Input value={company} onChange={(e) => setCompany(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Contact name *</Label>
                  <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <p className="text-xs text-muted-foreground md:col-span-2">
                  Enter a contact number or an email address — at least one is required.
                </p>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Source</Label>
                <Select value={source} onChange={(e) => setSource(e.target.value as never)}>
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>{s.replace("_", " ")}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Project</Label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Pagawaan ng Bata"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Line items</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, emptyDraft()])}>
              + Add item
            </Button>
          </CardHeader>
          <CardContent>
            <ItemRows items={items} onChange={setItems} />
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={submit} disabled={saving} size="lg">
          {saving ? "Saving…" : "Save inquiry"}
        </Button>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground">Quick intake (AI-assisted)</h3>
        <AiExtractPanel onExtracted={(extracted) => setItems((prev) => [...prev.filter((p) => p.rawText || p.parsedJson.description), ...extracted])} />
      </div>
    </div>
  );
}
