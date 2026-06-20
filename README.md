# AeroQuote — Industrial Fan & Blower Quotation System (MVP)

Turn fan & blower inquiries into printable quotations in **minutes instead of days**.

AeroQuote is an installable PWA for **Aerovent Fans and Blowers Manufacturing**. It **drafts**
quotations automatically — AI extraction of inquiries, catalogue matching, deterministic fan
sizing and pricing — but a **human always reviews and approves before a quote is sent**.

> **Engineer-in-the-loop:** the app *proposes*, an engineer *confirms*. Fan sizing is an
> engineering decision; nothing is presented as final without an explicit approval step.

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router, TypeScript) |
| UI | Tailwind CSS + shadcn/ui primitives |
| Database | Supabase Postgres via Prisma ORM |
| Auth | Supabase Auth (email/password) + a `role` column (SALES / ENGINEER / ADMIN) |
| Storage | Supabase Storage (uploaded photos / spec sheets) |
| AI | Anthropic Claude (`claude-sonnet-4-6`) — server-side only |
| PDF | `@react-pdf/renderer` (serverless-friendly, no headless Chromium needed) |
| PWA | Web manifest + service worker ("Add to Home Screen") |
| Tests | Vitest (unit conversion + selection engine) |

All proprietary data (catalogue, pricelist, rating curves) lives **in the database**, never
hard-coded — editable via the Admin screens or bulk CSV import.

---

## Quick start (local)

```bash
# 1. Install deps
npm install

# 2. Configure environment
cp .env.example .env
#    → fill in DATABASE_URL / DIRECT_URL (Supabase), the Supabase keys,
#      and ANTHROPIC_API_KEY.

# 3. Create the schema + seed realistic sample data
npm run prisma:generate
npm run prisma:migrate        # or: npm run prisma:push   (no migration history)
npm run seed

# 4. Run
npm run dev                   # http://localhost:3000
```

The app is **fully demoable right after `npm run seed`** — ~20 catalogue items across all
families, matching prices, rating curves for 4 fan models, 5 templates, and 2 sample inquiries
(one from a photo).

### Demo logins

The seed creates the **app role records** (matched by email). Create matching **Supabase Auth**
users (Supabase dashboard → Authentication → Users → *Add user*, or invite) with the same emails:

| Email | Role | Can do |
| --- | --- | --- |
| `sales@aerovent.example` | SALES | Inquiries, drafts, submit for approval |
| `engineer@aerovent.example` | ENGINEER | + confirm fan sizing, approve quotes |
| `admin@aerovent.example` | ADMIN | + manage users, catalogue, prices, templates |

> Auth identities and the app `User` table are joined **by email**. Add a person in Supabase Auth,
> then add/confirm their role under **Admin → Users**.

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Database** → copy the connection strings into `.env`:
   - `DATABASE_URL` → *Transaction* pooler string (port `6543`, add `?pgbouncer=true&connection_limit=1`).
   - `DIRECT_URL` → *Session*/direct string (port `5432`) — used by Prisma Migrate.
3. **Project Settings → API** → copy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   and the **service role** key (`SUPABASE_SERVICE_ROLE_KEY`, server-only).
4. **Storage** → create a bucket (default name `attachments`, set `SUPABASE_STORAGE_BUCKET`).
5. **Authentication** → enable Email provider; add the demo users above.

---

## Deploy to Vercel

1. Push this repo to GitHub and import it into Vercel.
2. Add every variable from `.env.example` in **Project → Settings → Environment Variables**.
3. Build command is `prisma generate && next build` (already in `package.json`).
4. Run migrations against your Supabase DB (locally or via a one-off):
   `npx prisma migrate deploy`.
5. Deploy. The PWA installs from the deployed URL via the browser's "Install app" / "Add to Home
   Screen".

`@react-pdf/renderer` is configured as a server external package — PDF generation runs in the
Node.js runtime on Vercel (no Chromium binary required).

---

## How it works (feature tour)

1. **Dashboard** — today's inquiries by status + "quotes drafted today".
2. **Inquiry intake** — three inputs, one normalized output (`InquiryItem.parsedJson`):
   - **Type details** — repeatable rows.
   - **Photo / spec sheet** — upload an image; Claude transcribes nameplates / handwritten RFQs /
     competitor quotes into editable line items. **You verify before saving.**
   - **Paste text** — paste an email; same extraction.
3. **Unit conversion** — deterministic (`src/lib/units.ts`). Airflow CFM ↔ m³/hr ↔ m³/s ↔ L/s;
   pressure Pa ↔ mmAq ↔ inWG ↔ kPa; mm ↔ inch. Stored internally in SI; displayed in the client's
   unit. **The AI never does the math.**
4. **Catalogue matching** — Claude proposes the best catalogue items (text/application only) with
   confidence + reasoning; the user picks. Invented model codes are filtered out server-side.
5. **Fan selection / sizing** — deterministic engine (`src/lib/selection/`). Interpolates rating
   curves and applies fan laws (Q∝N, P∝N², kW∝N³), density-corrects for temperature, sizes a
   standard motor with a service factor, and ranks candidates. Operating points **outside the
   rated envelope are flagged LOW confidence and require an engineer to confirm** before quoting.
6. **Quotation builder** — draft from chosen items + pricelist; inline edit; deterministic
   subtotal → VAT (12%, configurable) → total. Workflow: `DRAFT → PENDING_APPROVAL → APPROVED → SENT`.
   Approval requires Engineer/Admin.
7. **Templates + PDF + send** — pick one of 5 templates; download a clean PDF; once **SENT**, copy a
   public shareable link (`/q/<id>`). Quote numbers auto-increment per year (`AQ-2026-0001`).
8. **Admin** — CRUD for users, catalogue, rating points, templates; **CSV import** for bulk loading.

Quotation line items snapshot their description + specs (`*Snapshot` fields), so historical quotes
never change when the catalogue or pricelist is later updated.

---

## Plugging in your real data

Two ways: the **Admin UI** (Admin → Catalogue / Templates / Users) or **bulk CSV import**
(Admin → Import CSV). The selection engine and pricing read entirely from the DB, so no code
changes are needed.

### CSV import column specs

A header row is required. Errors are reported per row without aborting the batch.

**Catalogue** (`type: catalogue`)
```
modelCode, family, name, description, sizeLabel, uom, basePrice, currency, specsJson
```
- `family` ∈ `AXIAL | CENTRIFUGAL | PROPELLER | TUBULAR_INLINE | CABINET | ACCESSORY | SERVICE | OTHER`
- `basePrice` optional — creates/updates the default pricelist entry.
- `specsJson` optional — valid JSON (e.g. `{"drive":"belt","material":"SS304"}`).

**Pricelist** (`type: pricelist`)
```
modelCode, variantKey, currency, basePrice, optionsJson, effectiveDate
```
- `modelCode` must already exist. `variantKey` defaults to `default`.
- `optionsJson` optional — priced add-ons, e.g. `{"Epoxy coating":2200,"VFD":4500}`.

**Rating points** (`type: ratings`) — the fan-selection curve data
```
modelCode, rpm, airflow_m3hr, staticPressure_pa, power_kw, efficiency
```
- One row per point; several rows per model build its characteristic curve.
- Store airflow in **m³/hr**, static pressure in **Pa**, power in **kW**, efficiency as 0..1.

> Each importer also has a **"Load sample"** button in the UI showing the exact format.

### Where to edit things in code

| Want to change… | File |
| --- | --- |
| Company header / contact on PDFs | `src/lib/config.ts` (`COMPANY`) |
| VAT rate, currency, app URL, model | `.env` (`NEXT_PUBLIC_VAT_RATE`, etc.) → `src/lib/config.ts` |
| AI prompts | `src/lib/ai/prompts.ts` |
| Unit conversions | `src/lib/units.ts` (+ tests `units.test.ts`) |
| Fan sizing logic / service factor / motor sizes | `src/lib/selection/index.ts` (+ tests) |
| Seed sample data | `prisma/seed.ts` |
| Data model | `prisma/schema.prisma` |

---

## Project structure

```
prisma/
  schema.prisma          # data model (all tables + enums)
  seed.ts                # realistic sample data — fully demoable after `npm run seed`
src/
  app/
    (app)/               # authenticated shell: dashboard, inquiries, quotations, admin
    api/                 # server routes: ai/extract, ai/match, selection, quotations/[id]/pdf,
                         #   uploads, admin/import
    login/  q/[id]/  offline/
  components/            # shadcn/ui primitives + app components
  lib/
    units.ts             # deterministic unit conversions (tested)
    selection/           # fan sizing engine (tested)
    ai/                  # prompts, zod schemas, Claude client (validated JSON + retry)
    pdf/                 # @react-pdf/renderer quotation document
    import/              # CSV importers with per-row validation
    db.ts auth.ts quote.ts requirement.ts config.ts
public/                  # manifest.webmanifest, sw.js, icons
```

---

## Tests

```bash
npm test          # vitest run
```

Covers the two deterministic cores:
- **Unit conversion** — round-trips, table values, tolerant unit-string parsing.
- **Selection engine** — on-curve duty, fan-law speed scaling, density correction, envelope
  guarding (out-of-envelope → LOW confidence requiring engineer confirmation), mixed-RPM curve
  normalization, and ranking.

---

## Engineering notes

- **Strict TypeScript** + **zod** validation on every API boundary.
- All **AI calls are server-side** (`/api/ai/*`); the Anthropic key is never exposed to the client.
- AI responses are **parsed + zod-validated**, markdown fences stripped, and **retried once** on a
  parse failure (`src/lib/ai/client.ts`).
- Quote creation runs in a **Prisma transaction**; quote numbers are allocated atomically.
- **i18n-ready**: English default; strings are colocated and can be externalized for Filipino later.

---

## License

Proprietary — Aerovent Fans and Blowers Manufacturing. Sample data is illustrative.
