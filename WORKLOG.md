## 2026-08-19 · Stock matching — match a quoted line to stock by Item Code / SKU first
- **Request (owner, approved — touches frozen Phase 3).** Availability was decided purely by **fuzzy name text**, so a
  quoted item whose description differs from the inventory item's name (e.g. "Induction Motor (TECO)" vs "TECO 1HP
  4-Pole Motor") was reported **not available** even when the stock existed. Implements the permanent fix behind the new
  **Item Listing Standard**: match on the shared **Item Code / SKU** first.
- **Change (additive, backward-compatible).**
  - `lib/inventory.ts` `listStockItemsWithAvailability` now also returns `sku`.
  - The order page's stock-items query (`orders/[id]/page.tsx`) selects + carries `sku` through to the panels (parents
    pass the object wholesale, so no other call sites change).
  - `stock-match-panel.tsx` `StockOpt` gains an optional `sku`, and `autoMatchId` gets a **top tier**: if a stock
    item's SKU (canonicalised, length ≥ 4) appears in the line text, that's an exact identity and outranks every fuzzy
    name score (the longest matching SKU wins). Length-gated so a short code can't collide inside an unrelated word.
- **Effect.** When both the quote line and the inventory item carry the same Item Code (the Standard's rule), stock is
  found regardless of wording. When no SKU is present the behaviour is exactly as before — nothing regresses.
- Does not change who acts / step order / gating / stage progression — matching accuracy only. Typecheck + lint clean.
  (Left unmerged for owner review, per the frozen-area rule.)

## 2026-08-19 · Fan selector — disable "Run selection" until the product selection resolves a catalogue
- **Request (owner).** For KDK **Wall Mounted Fan**, pressing "Run selection" with the **Series** still unset returned
  an irrelevant mixed list (CFAB/CIEB/…). Proper behaviour: the button can't be pressed until a Series is chosen.
- **Cause.** A Wall Mounted Fan with no Series makes `selectionTag` resolve to an **empty tag**, so `/api/selection`'s
  `catalogueWhere` returns `{}` and queries **every** catalogue at once.
- **Fix (quotation builder, not frozen).** New `selectionBlockedReason(specs)` — returns a reason (e.g. *"Select a
  series first."*) when `selectionTag` is empty, else null. The "Run selection" button is now **disabled** in that
  state (with the reason as a tooltip + a hint line beneath it), and `runLineSelection` bails early as a programmatic
  backstop. Every product that already resolved a real tag is unaffected. Typecheck + lint clean.

## 2026-08-19 · Deploy — revert `migrate deploy` in the build (it blocked all deploys); fix schema via SQL
- **Root cause (production outage).** The fan-selector hardening surfaced the real error:
  *"The column `CatalogueItem.storeListed` does not exist in the current database."* Phase A (PR #368) added the store
  columns to the Prisma schema + migration `0043`, but the DB migration was **never applied**.
- **First attempt (reverted).** Adding `prisma migrate deploy` to the build command **failed the Vercel build**
  (`… exited with 1`) — the production DB's Prisma migration history doesn't reconcile with `migrate deploy` (tables
  0001–0042 exist but aren't cleanly recorded), so it errored and, via `&&`, **blocked every deploy**. Reverted the
  build command back to `prisma generate && next build` so deploys work again.
- **Actual fix.** Apply migration `0043` directly (it's additive + idempotent) via the Supabase SQL editor / manual
  `prisma migrate deploy` — creates the missing `storeListed` / `storeSlug` / … columns and the selector recovers.
  README updated to flag the manual migration step. (A proper fix for auto-migrations would first baseline the DB's
  migration history; deferred.)

## 2026-08-19 · Fan selector — never crash on an empty response ("Unexpected end of JSON input")
- **Bug (owner-reported).** Running the fan selector on KDK products showed **"Failed to execute 'json' on 'Response':
  Unexpected end of JSON input."** Cause: when `/api/selection` returns a **500 with an empty body** (an uncaught
  throw in the route handler yields no body), the client called `res.json()` **before** checking `res.ok`, so the
  empty-body parse error masked the real HTTP status — the user never saw what actually failed.
- **Fix (server).** Wrapped the catalogue query + `selectFans` in a try/catch that always returns a **JSON** body
  (`{ error }`, 500) and logs the failure server-side. The endpoint can no longer return an empty body.
- **Fix (client).** All three callers (`quotation-builder.tsx`, `tools/selection-tool.tsx`,
  `inquiries/[id]/inquiry-workspace.tsx`) now read the body as **text first**, parse defensively, and check `res.ok`,
  surfacing the real error (or `HTTP <status>`) instead of the opaque JSON-parse message.
- Not a frozen area (quotation/selection, upstream of the order workflow). Typecheck + lint clean.

## 2026-08-19 · Stock transfers — searchable item picker on "Request transfer to Office"
- **Request.** The item picker was a plain `<select>` of all stock options; hard to find an item in a long list.
- **Change (inventory UI, not frozen).** New `ItemPicker` combobox in `stock-transfers.tsx`: a text input that filters
  stock options by **name / location** as you type, with a click-to-select dropdown (shows availability + unit, caps at
  50 results). Replaces the `<select>` in the Request-to-Office form; each row uses its own picker. Value/onChange
  unchanged, so submit logic is untouched.
- Typecheck + lint clean.

## 2026-08-19 · Revert the bought-in / Office requisition changes + order-page stock view (user-error concern)
- **Request (owner).** The concern that started these — "a bought-in motor in stock still asks for a PO" — was a
  **user error**: the motor is genuinely **bought-in**, so raising a PO is correct. Owner asked to "return the settings
  before I raise this concern." Reverted the five follow-on changes (A–E) and returned to the pre-concern state.
- **Reverted:** the order-page read-only stock view (#368's `showStockCheck` on the Phase 4 card only — the rest of
  Phase A unification stays); the full-item-spec requisition remark (#369); the direct-bought-in `hideApproval`/`mrfNo`
  unstick (#370); the `requisitionNeedsPlantApproval` skip-Plant-Manager rework (#371); and the single-stage
  approval + matching badge (#372). `requisitionNeedsPlantApproval` / `needsPlantApproval` are gone; `effectiveStepRole`
  is back to its `isDepartment` flag. Bought-in / Office requisitions behave exactly as they did before the concern.
- Kept: the searchable stock-transfer item picker (independent) and all of Phase A unification. Typecheck + lint clean.

## 2026-08-19 · Unification Phase A2/A3 — Store products admin (manage listing on the catalogue record)
- **Goal.** The mockup's "Products" screen: manage each catalogue item's storefront listing on the same record that
  drives the ERP; derived website price shown read-only; fabricated fans = quote-only.
- **New Admin → Store products** (`/admin/products`): server page loads active catalogue items (+ latest active price
  per variant → representative AeroQuote price → derived website price) and renders `StoreProductsManager` (client).
  Filters (All / Listed / Draft / Quote-only), a per-row **Listed/Draft** quick toggle, and an inline editor for
  **slug, category, description, photos**. Added the tab to the admin nav.
- **Server actions** (`admin/actions.ts`): `saveStoreListing` (validates, ensures a unique slug — a listed item always
  gets one, derived from the model code if blank) and `setStoreListed` (quick toggle). Both admin-gated.
- **Photos**: new admin-only `src/app/api/store-uploads/route.ts` (POST upload under `store/…` via `uploadToStorage`,
  GET signed-URL preview) — mirrors the marketing-uploads pattern. The editor uploads, previews, and removes photos;
  paths are saved into `storePhotos`.
- **A3 folded in**: website price is derived (÷ 0.95) and read-only; `isQuoteOnly()` marks fabricated fans with a
  Quote-only badge and no list toggle / price.
- Typecheck + lint clean. (No DB in sandbox — the 0043 migration + these screens exercise on deploy.)

## 2026-08-19 · Unification Phase A1 — store fields on the catalogue item (foundation)
- **Goal.** Start store ⇄ ERP unification: one catalogue record drives both the ERP/AeroQuote and the storefront.
- **Schema + migration `0043_catalogue_store_fields`.** Additive, optional columns on `CatalogueItem`: `storeListed`
  (default false — off the store until set), `storeSlug` (unique, nullable), `storeCategory`, `storeDescription`,
  `storePhotos` (JSONB `[]`). Website price stays DERIVED (round(AeroQuote / 0.95)), never stored. RLS block kept per
  convention.
- **New `src/lib/store-product.ts`** — `storeFieldsOf()` reader, `deriveStoreSlug()`, `storeCategoryLabel()`,
  `coerceStorePhotos()`, and `isQuoteOnly()` (fabricated fans = quote-only, mirroring the price-list exclusion set).
- Nothing wired to UI yet (that's A2, the Products admin). `prisma generate` + typecheck + lint clean. Migration
  applies on deploy (no DB in this sandbox).

## 2026-08-19 · Email — split multi-address recipient fields (fix Resend 422)
- **Bug.** A client record can hold several emails in one field (e.g. "a@x.com ; b@y.com ; c@z.com"). The mailer passed
  that whole string as one recipient, so Resend rejected it: `422 validation_error — Invalid to field`. That client's
  email (marketing/follow-up/etc.) silently failed to send.
- **Fix (central, non-frozen).** New `splitRecipients()` in `src/lib/email/resend.ts` splits `to` on `; , \n`, trims,
  and keeps address-looking tokens; `sendEmail` now sends the resulting **array** (throws a clear error if none are
  valid, instead of a cryptic 422). Fixes every sender at once — marketing, follow-ups, thank-you, RFQ.
- A single or "Name <email>" address passes through unchanged; a record with 3 addresses now emails all three.
- Typecheck + lint clean; verified the exact failing input now yields a valid 3-address array.

## 2026-08-19 · Job Orders — make "More Details" an editable per-row field (Duct, Accessories, Motor)
- **Request (owner-approved, frozen Phase 2 area).** The "More Details" column (added blank earlier) is now an
  **editable field the JO creator types per row**, saved with the JO and printed into that column.
- **Data model** — added `moreDetails: string` to `DuctSegment`, `MotorControllerLine`, `AccessoryLine` (+ their
  `EMPTY_*` blanks and coercion, so old JOs load with an empty value). Accessories keeps its existing per-line `note`
  (feeds the remarks box); `moreDetails` is distinct and feeds the column.
- **Editors** — a "More details" text input per row in `duct-job-order-panel.tsx`,
  `motor-controller-job-order-panel.tsx`, `accessories-job-order-panel.tsx`.
- **Save actions** — `ductSegmentSchema` / `accLineSchema` / `mcLineSchema` gain `moreDetails`, carried through each
  save mapping. `job-order-autogen.ts` sets it to "" on auto-generated motor/accessory lines.
- **Print** — the three xlsx exporters now write `moreDetails` into the More Details cell (col 8 duct, col 7 acc/motor)
  instead of a blank.
- Typecheck + lint clean; smoke test confirmed a typed value lands in the correct printed column for all three.

## 2026-08-19 · Job Orders — add a blank "More Details" column (Duct, Accessories, Motor Controller)
- **Request (owner-approved, frozen Phase 2 area).** Add a right-most **"More Details"** column to the printed job
  orders — a blank column the engineer fills in by hand — sized the same as each sheet's main dimensions/description
  column.
- `src/lib/excel/duct-job-order-xlsx.ts` — new column H (width 32, = the dimensions column); `LAST` G→H, header +
  blank cells, header/signature/date merges widened to the new edge.
- `src/lib/excel/accessories-job-order-xlsx.ts` — new column G (width 34, = Dimensions); `LAST` F→G, date value merged
  to the edge.
- `src/lib/excel/motor-controller-job-order-xlsx.ts` — new column G (width 34, = the method column); `LAST` F→G, date
  value merged to the edge.
- The new column is left-aligned + wrapping and blank on every row (no data source — a write-in field).
- Typecheck + lint clean; smoke-built all three workbooks (incl. a reducer row) with no ExcelJS merge errors.

## 2026-08-19 · Duct Job Order — label sizes in the quotation's real unit (was hardcoded "mm")
- **Bug.** The Duct JO printed every segment size as **"mm"** (`formatSegmentDimensions` hardcoded the unit), but the
  numbers are carried straight from the quotation, which enters duct sizes in **inches**. So a 14-inch duct printed as
  "14 x 14 x 44 mm" — right number, wrong unit — mismatching the quotation's "14 in x 14 in".
- **Fix (owner-approved this conversation — frozen Phase 2 area).** Carry the quotation's size unit onto the job order
  instead of hardcoding one:
  - `src/lib/duct-job-order.ts` — added `unit` to `DuctSegment` (+ `EMPTY_DUCT_SEGMENT`, coercion falls back to
    "inches" so historical inch JOs read correctly). New `ductUnitLabel()` ("inches"→"in", mm, cm); `formatSegmentDimensions`
    now uses it. This flows to both the on-screen preview and the **xlsx export** (both call the same helper).
  - `src/lib/job-order-autogen.ts` — both duct-segment builders set `unit: str(s.sizeUnit) || "inches"`.
  - `src/app/(app)/orders/actions.ts` — `ductSegmentSchema` gains `unit` (default "inches") and the save carries it.
  - `duct-job-order-panel.tsx` — the "Length (mm)" edit labels now show the segment's actual unit.
- No numbers changed — only the unit label; inch quotes now print "in", mm/cm quotes print their own unit.
- Typecheck + lint clean.

## 2026-08-19 · Follow-up "Max emails per run" — allow no limit (0 = unlimited)
- **Goal.** The 100 email/run throttle was a genuine hard ceiling; the owner wants to be able to remove it and send
  every due client in one run.
- **`src/lib/follow-up-settings.ts`** — dropped the `Math.min(..., 100)` clamp on `maxPerRun`; now **0 = no limit** and
  any positive value throttles (invalid falls back to the safe default 100, not unlimited). Split the constants:
  `FOLLOW_UP_DEFAULT_PER_RUN = 100` (email default) vs `FOLLOW_UP_MAX_PER_RUN = 100` (**SMS** ceiling, kept — Semaphore
  bills per text, so unlimited SMS was deliberately NOT enabled).
- **`src/lib/follow-up-runner.ts`** — `sendCap` treats `maxPerRun <= 0` as `POSITIVE_INFINITY` (send all due).
- **UI** — email input min changed `1 → 0`, removed `max={100}`; helper text documents `0 = no limit` with a
  deliverability/Resend-quota caution. The "Follow-ups due" live banner now shows "no per-run limit" when set to 0.
  SMS "max texts per run" stays capped at 100.
- Typecheck + lint clean. (Follow-up/email is not a frozen area — frozen = Order Phases 1–5 only.)

## 2026-08-17 · Public Fan Selector API (for the online store's HVAC Tools page)
- **Goal.** The store's HVAC Tools page needs a real "Fan Selector" that sizes an AeroVent fan/blower for a visitor's
  duty — **performance shown, prices NOT** (the standing rule).
- **New route `src/app/api/public/fan-select/route.ts`** — an unauthenticated, CORS-open (`*`) POST endpoint that runs
  the **same selection engine** the staff quotation builder uses (`selectFans` in `src/lib/selection`). It is
  performance-only by construction: `SelectionResult` carries **no price field** (prices live in a separate price map
  applied only inside the app), and `toPublicResult()` is a second guard that whitelists exactly the performance
  fields exposed (model, size, rpm, motor HP/kW/pole, blade angle, delivered airflow, static pressure, BHP/kW,
  efficiency, outlet velocity, confidence, warnings) — never the internal catalogue id or any cost.
  - Takes `{ airflow, airflowUnit(cfm|m3hr), staticPressure, pressureUnit(inwg|pa), tag? }`; units resolved via
    `lib/requirement.toDutyPoint` (same as the staff route).
  - Only the curated families in `PUBLIC_FAMILIES` are reachable (CEB/CFAB/CIEB/DIDW, EWF/FAWF/PRV belt+direct,
    TAF/VAF). An unknown tag is rejected; blank tag sweeps the centrifugal flagships. Propeller/roof families default
    to 0.5" w.g. when no SP is given (matches the staff route). Direct-only families fix the drive server-side.
  - Returns the recommended pick centred in a ±3-size window (same UX as the internal selector). `GET` returns the
    family + unit lists for discovery. `OPTIONS` handles the CORS preflight.
- **`middleware.ts`:** added `/api/public/` to `PUBLIC_PATHS` so the store (no login cookies, cross-origin) can reach
  it. Scope is deliberately broad-but-safe: read-only public data APIs only.
- **Store embed:** `hvac-tools-embed.html` gains a **Fan Selector** tab (now the flagship first tab) that POSTs to the
  API and renders the ranked selections with a RECOMMENDED badge + confidence, and a "Request a Quotation" CTA. No
  price is ever shown.
- Typecheck + lint clean. (Selection engine is **not** a frozen area — only Order Phases 1–5 are.)

## 2026-08-17 · Marketing images — the actual root cause: auth middleware (make route public)
- **The real reason images never showed.** DevTools Network revealed every `<img>` request to
  `/api/marketing-image/…` was being **302'd to `/login?next=…`** and failing (`ERR_BLOCKED`). The route was **not in
  `middleware.ts`'s `PUBLIC_PATHS` allowlist**, so the auth middleware gated it. A logged-in browser opening the URL
  directly passed (cookies present) — which is why direct opens always worked — but an embedded `<img>` (the
  `about:srcdoc` preview iframe, and recipients' mail-client image proxies) sends **no login cookies**, so it was
  redirected to the login page. The request never reached the route; none of the URL/streaming changes could matter.
- **Fix:** add `/api/marketing-image` to `PUBLIC_PATHS` (same as `/api/marketing-track`, `/unsubscribe`, `/rfq`). Safe
  — the route is already HMAC-token-checked and scoped to `marketing/` only.
- The three prior changes remain correct and necessary (on-domain URL, path form to dodge `&amp;`, streaming bytes to
  dodge the cross-origin redirect); this allowlist entry is what finally lets mail clients reach it.
- Typecheck + lint clean.

## 2026-08-17 · Marketing images — stream bytes instead of redirecting
- **Follow-up.** With the path-URL fix, opening an image URL directly worked (302 → signed Supabase URL → image),
  but the image still rendered **broken when embedded** — in the in-app live preview *and* mail clients. Cause: an
  embedded `<img>` (mail-client image proxy / sandboxed preview iframe) doesn't reliably follow a **cross-origin 302**
  redirect, even though direct navigation does. (No CSP involved — confirmed none in the app.)
- **Fix:** the proxy route now **streams the image bytes back directly** (a same-origin `200` with the image body +
  `Content-Type` + long `Cache-Control`) instead of 302-redirecting to Supabase. New `downloadBytes()` in
  `storage.ts`; the route downloads via the service client and returns the bytes. The raw signed URL never leaves the
  server. Token scheme / path-URL shape unchanged.
- Typecheck + lint clean; `next build` compiles (pre-existing `/reset-password` prerender error only).

## 2026-08-17 · Marketing images — fix broken images (query `&` → path URL)
- **Follow-up to the entry below.** The first version put the token in a query string
  (`/api/marketing-image?p=<path>&t=<token>`). In the email HTML the `&` is (correctly) escaped to `&amp;`, but
  mail clients then parse the second param as **`amp;t`** — so `t` arrives empty, the token check fails, and every
  image 404s ("Not found"). Confirmed live: the same URL with a literal `&` loaded the image fine.
- **Fix:** the token + path now live in the URL **path** — `…/api/marketing-image/<token>/<storage-path>` — so there's
  no `&` to escape. Route moved to `src/app/api/marketing-image/[token]/[...path]/route.ts`; `marketingImageUrl()`
  builds the path form. Token scheme / redirect-to-signed-URL behaviour unchanged.
- Typecheck + lint clean; `next build` compiles (pre-existing `/reset-password` prerender error only).

## 2026-08-17 · Marketing emails — serve images from our sending domain (deliverability)
- **Owner report:** Resend's "Needs attention" insight flagged **"Host images on the sending domain"** — campaign
  emails embedded raw Supabase Storage URLs (`…supabase.co/storage/v1/object/sign/…`), which Gmail treats as a mild
  spam signal since they don't match the sending domain (`aeroventfbm.shop`).
- **Change:** campaign image `<img src>`s now point at our own domain instead of `supabase.co`.
  - New `src/lib/marketing-image-link.ts` — `marketingImageUrl(path)` builds `{appUrl}/api/marketing-image?p=<path>&t=<token>`,
    where `t` is an HMAC of the storage path (same scheme as the RFQ / unsubscribe links; permanent, so links keep
    working for emails opened weeks later).
  - New public route `src/app/api/marketing-image/route.ts` — verifies the token (only the `marketing/` scope is
    reachable, token unforgeable) and **302-redirects to a freshly-signed, short-lived (1 h) Supabase URL**. Gmail's
    image proxy follows the redirect, so images still load — but from our domain — and the raw signed URL never
    appears in the email HTML.
  - `resolveCampaignImageUrls()` (`marketing-runner.ts`) now emits `marketingImageUrl(p)` instead of
    `longLivedImageUrl(p)` (the ~3-yr Supabase signed URL). Now synchronous; the three call sites drop their `await`.
- Since the app runs on `quote.aeroventfbm.shop` — a **subdomain** of the `aeroventfbm.shop` sending domain — this
  fully satisfies Resend's "sending domain or a subdomain" rule. No env changes needed. (Only the rich campaign
  builder embeds Storage images; the plain follow-up emails are unaffected.)
- Typecheck + lint clean; `next build` compiles (only the pre-existing `/reset-password` prerender error, from the
  build sandbox lacking Supabase env, remains — unrelated).

## 2026-08-14 · Website price list export (for the online store)
- **Owner request:** get Name + price of all products **except fabricated Fans & Blowers** from AeroQuote, with a
  website price = AeroQuote price ÷ 0.95 (rounded to nearest ₱1) to cover the 5% online processing fee.
- **Change:** new `src/lib/website-price-list.ts` — queries active catalogue items with `family NOT IN`
  {AXIAL, CENTRIFUGAL, PROPELLER, TUBULAR_INLINE, CABINET} (the fabricated fan/blower families), takes the latest
  active price per variant, and computes `websiteSellingPrice = round(basePrice / 0.95)`. Admin CSV route
  `GET /api/admin/website-price-list` (columns: Category, Model Code, Name, Variant, UoM, AeroQuote Selling Price,
  Website Selling Price) + a **Download website price list (CSV)** button on Admin → Import.
- (Data lives in the live Supabase DB, unreachable from the build sandbox — so this is delivered as an in-app
  export the owner runs against real data.) Typecheck + lint clean; `next build` compiles.

## 2026-08-14 · Marketing builder — remove "personalized for …" label
- **Owner request:** remove the "personalized for <company>" text next to the Live preview header.
- **Change (`campaign-builder.tsx`):** dropped that `<span>` from the preview header. UI-only; typecheck + lint clean.

## 2026-08-14 · Assigned RFQ → salesperson notification + RFQ files become inquiry docs
- **Owner request:** when an RFQ is assigned to a salesperson, they should get a notification in the Inquiries tab,
  and the RFQ file(s) should be viewable / printable / downloadable.
- **Files onto the inquiry (`createInquiryFromInbound`):** web-form attachments now carry a Storage `path`
  (`InboundAttachment.path`, set by `/api/rfq`). On conversion each is **copied** into the inquiry's own storage
  (`inquiries/<id>/…`, owner-scoped access) and recorded under the **RFQ / BOQ** document slot — so they render in
  the existing inquiry doc viewer with **eye-view / download** (and print via the opened file). External email-only
  links stay as note links. (Older queue items without a `path` fall back to note links.)
- **Notification (`src/lib/inquiry-notifications.ts`, AppSetting-backed, no migration):** assigning to someone
  other than the converter drops a per-user note. Surfaces as: a **blinking count** on the **Inquiries** nav tab
  (`navCounts["/inquiries"]`) and an **amber banner** on the Inquiries list ("N new RFQs assigned to you — client ·
  assigned by X · Open →"). Opening the inquiry **clears** that user's note.
- Typecheck + lint clean; `next build` compiles.

## 2026-08-14 · Inbound RFQs — fix misleading "not wired up / stays empty" banner
- **Owner report:** the amber banner said the queue "stays empty" until the Resend webhook is set — misleading,
  since the `/rfq` web form already feeds the queue (RFQs were arriving; several handled).
- **Change (`review-queue.tsx`):** reworded to an informational (sky) note — the website **Request a Quotation**
  form (`/rfq`) already feeds this queue; `INBOUND_WEBHOOK_SECRET` + the Resend inbound webhook are only needed to
  **also** capture RFQs sent as email replies. Copy-only. Typecheck + lint clean.

## 2026-08-14 · Inbound RFQs — assign the converted inquiry to a salesperson
- **Owner request:** add an option to assign an inbound RFQ to anyone in sales.
- **Change:** each pending inbound-RFQ card now has an **"Assign to"** dropdown (default "Me (whoever converts)",
  plus every salesperson from `getSalespeople()` — all SALES-role users + sales-flagged engineers). On **Create
  inquiry** the chosen salesperson becomes the inquiry's owner (`createdById`), so it lands in their pipeline and
  credits them in the sales reports; with no pick it stays owned by the converter (unchanged behaviour).
- **Server (`createInquiryFromInbound`):** takes an optional `assigneeId`, validated against the salesperson list
  (rejects anything else), sets `createdById` accordingly, and records `assignedToName` on the queue item; the
  Handled view now shows "assigned to <name> · by <converter>". `getSalespeople` wired into the page.
- Typecheck + lint clean; `next build` compiles.

## 2026-08-14 · Unsubscribe page — fix literal "You&rsquo;ve" heading
- **Owner report:** the confirmation heading showed the raw entity `You&rsquo;ve been unsubscribed`.
- **Cause:** the `shell()` **title** is a plain JS string, which React renders as text without decoding HTML
  entities (unlike the `<p>` JSX children, where `&rsquo;` decodes) — so the entity printed literally.
- **Fix (`unsubscribe/page.tsx`):** used the actual `’` character in the title string. Typecheck + lint clean.

## 2026-08-14 · RFQ ack email — plain-text emails (clear Resend link-domain insight)
- **Owner note:** Resend's "Needs attention" insight flagged the body `mailto:` links (@aeroventfbm.com) as not
  matching the sending domain (@aeroventfbm.shop) — a spam-filter heuristic (email still delivered fine).
- **Change (`api/rfq/route.ts`):** dropped the `mailto:` anchors on Info/Technical + Sales in the ack email; the
  addresses now render as plain text (still visible/copyable, and most clients auto-linkify). Reply-To (a header,
  not a body link) is unchanged. Clears the only body-link mismatch. Typecheck + lint clean.

## 2026-08-14 · RFQ ack email — full contact block
- **Owner request:** include the complete contact details in the acknowledgement email.
- **Change (`api/rfq/route.ts`):** the "We've received your request" email footer now lists all lines —
  Landline (02) 85619413; Smart 0928-948-0600 / 0999-664-9997; Globe 0927-325-8887 / 0954-429-8999; Info/Technical
  info@aeroventfbm.com; Sales sales@aeroventfbm.com (emails are mailto links) — in both the HTML and plain-text
  bodies. Matches the `/rfq` page footer. Typecheck + lint clean.

## 2026-08-14 · RFQ — "Submit Request" + email & SMS acknowledgement to the client
- **Owner request:** rename the button to **"Submit Request"**, and on submit notify the client (email **and** SMS)
  that we received their inquiry.
- **Button** (`rfq-form.tsx`): "Submit request" → "Submit Request".
- **Acknowledgement (`api/rfq/route.ts`):** after the RFQ is safely queued, best-effort send:
  - **Email** via Resend (from the configured follow-up sender, reply-to sales@aeroventfbm.com) — "We've received
    your request" with a short branded body + contact details.
  - **SMS** via Semaphore — only when the phone normalizes to a PH mobile (`normalizePhMobile`): a one-line
    acknowledgement.
  Both are wrapped in try/catch and only run when their channel is configured (`emailConfigured` / `smsConfigured`),
  so a send failure (or missing key) never fails the submission. Typecheck + lint clean; `next build` compiles.

## 2026-08-14 · RFQ form — fix multi-file add (only one file stuck)
- **Owner report:** on `/rfq`, only a single file could be attached — adding more didn't work.
- **Root cause (`rfq-form.tsx`):** `addFiles` read the live `FileList` **inside** the `setPicked` updater, but the
  input was reset (`value = ""`) right after queuing the update — clearing that same `FileList` before the deferred
  updater ran, so subsequent picks added nothing. Side-effects (`createObjectURL`, id counter) also lived inside the
  updater (double-invoked under StrictMode).
- **Fix:** snapshot `Array.from(list)` up front, reset the input, then compute the additions (dedupe vs the current
  files + within the batch, enforce the 10-file / 15 MB / 40 MB caps) **outside** the updater, and commit with a pure
  `setPicked((prev) => [...prev, ...additions])`. Multi-select in one dialog and adding across several picks both
  work now. Typecheck + lint clean; `next build` compiles.

## 2026-08-14 · Inbound RFQs — blinking count badge on the nav + RFQ page contact details
- **Owner request:** show a number + blinking highlight on the **Inbound RFQs** sidebar item when RFQs are waiting,
  and put the real contact numbers / emails on the `/rfq` page footer.
- **Nav badge:** added a `navCounts` prop to `AppNav` + `MobileNav`; the app layout counts **pending** inbound-RFQ
  queue items (for ADMIN / SALES / ENGINEER — who see the tab) and passes `{"/inbound-rfq": n}`. When n > 0 the item
  shows a **blinking red pill with the number** (`animate-approver-blink`, "99+" cap); it takes priority over the
  existing amber activity dot. Zero → no badge.
- **RFQ footer (`/rfq`):** replaced the single email/landline line with the full block — Landline (02) 85619413;
  Smart 0928-948-0600 / 0999-664-9997; Globe 0927-325-8887 / 0954-429-8999; Info/Technical info@aeroventfbm.com;
  Sales sales@aeroventfbm.com (emails are mailto links). Typecheck + lint clean; `next build` compiles.

## 2026-08-14 · RFQ form — accumulate multiple files with per-file preview + remove
- **Owner request:** on the public /rfq form, let the client add multiple files and preview each ("eye view").
- **Problem:** the native file input **replaces** its selection each pick, so a client couldn't build up several
  files, and there was no way to view or drop an individual one.
- **Change (`rfq-form.tsx`):** files are now held in React state. A **"Choose files" / "Add more files"** button
  appends across picks (dedupes by name+size, resets the input so the same file can be re-added after removal). Each
  file shows a row with an **image thumbnail** (or a file icon), name + size, an **eye button** that opens a preview
  in a new tab (object URL), and an **✕ remove**. Client-side limits mirror the server (10 files, 15 MB each, 40 MB
  total) with friendly inline errors, and a running "N files · X MB total" line. On submit the files are appended to
  the FormData from state (not the input). Object URLs are revoked on remove/unmount. Typecheck + lint clean;
  `next build` compiles.

## 2026-08-14 · Public RFQ intake page — marketing CTA → client uploads their RFQ
- **Owner request:** make the email-marketing CTA point to a page where the client can upload their RFQ. (The
  Inquiries tab is behind login — external clients can't reach it — so this needed a public page.)
- **New public page `/rfq`** (`src/app/rfq/page.tsx` + `rfq-form.tsx`): a branded, no-login "Request a Quotation"
  form — company, contact, email, phone, message, and multi-file upload (PDF / images / Excel / Word / CAD / ZIP).
- **New public API `POST /api/rfq`** (`src/app/api/rfq/route.ts`): validates + stores files in the private bucket
  (`rfq-uploads/…`) and drops a **pending item into the existing Inbound RFQ queue** (`addInboundItem`) — the same
  place emailed RFQs land, so Sales reviews it and clicks the existing **"Turn into an inquiry"**. No auto-inquiry.
  Guards: honeypot field, per-IP rate limit (5 / 10 min), file type + 15 MB/file + 40 MB/submission + 10-file caps.
- **Attachments** served staff-only via `GET /api/rfq-uploads/view` (auth-checked, `rfq-uploads/` paths only).
- **Middleware:** whitelisted `/rfq` + `/api/rfq`; tightened the public-path matcher to a path-segment boundary so
  `/api/rfq` does **not** also expose the staff-only `/api/rfq-uploads/view`.
- **Per-client prefill (`src/lib/rfq-link.ts`):** each recipient's CTA carries `?c=&t=` (HMAC token, same scheme as
  unsubscribe) — applied **only** when the CTA points at `/rfq` (`appendRfqPrefill`, wired into `buildCampaignEmail`
  HTML + text and the runner's live/preview/A-B/scheduled sends), so the form pre-fills their details and attributes
  the RFQ to their client record. Token/id are never appended to any other CTA URL.
- **Default CTA** for new campaigns now points at `{appUrl}/rfq` (was the website). Typecheck + lint clean;
  `next build` compiles. NOTE: set the existing campaign's CTA link to `https://<app-domain>/rfq`, and ensure
  `NEXT_PUBLIC_APP_URL` is the real domain so tokens/links resolve.

## 2026-08-14 · Duplicate clients — export a report (Excel/CSV) before deleting
- **Owner request:** after importing 1,000+ clients, check for duplicate emails and **report to an Excel file
  first, before deleting**.
- **Change:** the Admin → Duplicate clients page already groups by normalized email (and company/person/phone);
  added a **Download Excel report** + **Download CSV** button (`duplicates-export.tsx`) that exports the
  currently-listed duplicate groups. Columns: Group #, the shared value (e.g. the email), Company, Contact name,
  Email, Phone, Inquiries, Salesperson(s), Client ID — one row per client record, blank line between groups, bold
  header + auto-filter. **Read-only** — nothing is deleted/merged; it's the review step before using the existing
  per-record Delete / Merge. Excel lazy-loads `exceljs`; client-side Blob download. Typecheck + lint clean;
  `next build` compiles.

## 2026-08-14 · Bulk import — download a ready-to-fill template (Excel or CSV)
- **Owner request:** on the Admin → Import page, add a way to download a template file to fill in.
- **Change (`admin/import/page.tsx`):** added **Download Excel template** and **Download CSV template** buttons next
  to "Load sample into editor". Each builds a header-row + one-example-row file for the currently-selected data type
  (Catalogue / Pricelist / Rating points / Clients), so e.g. the Clients template ships the exact
  `company, contactName, email, phone, address, notes` headers. CSV downloads the spec sample verbatim; Excel
  lazy-loads `exceljs` (same lib the reader uses), parses the sample with a small RFC-4180 CSV parser, bolds the
  header row and sizes the columns. Client-side Blob download; no server route. Typecheck + lint clean; `next build`
  compiles.

## 2026-08-14 · Purchasing — split (multi-supplier) kept the child's approval (frozen Phase 4)
- **Owner report (frozen Phase 4):** splitting an approved requisition across two suppliers sent one PO to
  Accounting correctly, but the **other split-off list dropped back to Pending** — re-demanding the Payment
  Approver's purchase approval even though the requisition was already approved.
- **Root cause (`splitPurchaseRequest`):** the new child request was created with `status: APPROVED` but **none of
  the approval stamps** — no `chainLog` (which carries `approve_po`) and no `decidedBy…`. For a material/MRF
  requisition, `statusBucket` treats `APPROVED` **without** `approve_po` as **"pending"** (`purchasing.ts:63`), so
  the child fell back into the Pending bucket while its sibling (which kept the PO + `approve_po`) proceeded.
- **Fix:** the split now carries the parent's approval onto the child — `decidedById/decidedByName/decidedAt/
  decisionNote` and the `chainLog` (with `approve_po`). Splitting is only ever allowed once the purchase is
  approved (the guard blocks it while pending), so this stamp always exists on the parent; the child now stays at
  **"Approved — awaiting its own PO"**, the Purchaser prepares the second supplier's PO, and it flows to Accounting
  like the first. Typecheck + lint clean; `next build` compiles & type-validates.

## 2026-08-13 · Receipt reader — VIS Industrial + Trade One sales invoices
- **Owner lessons (2 sales invoices):** VIS Industrial Corp. (No. 119839 → 20,320.00) and Trade One Incorporated
  (No. 000964 → 116,178.00). Both confirm the standing rule — the **VAT-inclusive gross** ("Total Sales (VAT
  Inclusive)" / "Total Amount Due") is the reconciliation **Actual**.
- **Change (`api/ai/read-receipt` + `read-cash-receipt`):** added both suppliers to the booklet list; added worked
  serials **119839** and leading-zero **000964**; and added them to the "no/blank withholding line → Total Amount
  Due = gross" examples — Trade One explicitly shows "Less: Withholding Tax **0.00**" so its Total Amount Due
  116,178.00 is the gross. Prompt-only; typecheck + lint clean.

## 2026-08-13 · Receipt reader — book the printed invoice date, not the payment due date
- **Owner correction:** for Rite Products (and any PDC / post-dated-check invoice), use the **printed invoice
  "Date" 05/28/2026**, NOT the "Payment Due Date" 06/12/2026. Reverses the PDC exception added earlier today.
- **Change (`api/ai/read-receipt` + `read-cash-receipt`):** replaced the "PDC → use Payment Due Date" exception
  with an explicit rule to **always use the printed invoice date**, never a "Payment Due Date" / "Payment
  Term"/"PDC" date or "Delivery Date" (worked Rite example: Date 05/28/2026 with Payment Due Date 06/12/2026 → use
  05/28/2026). Prompt-only; typecheck + lint clean.

## 2026-08-13 · Receipt reader — 5 more suppliers, alphanumeric serial, handwritten PAID/EWT trap
- **Owner lessons (5 sales invoices):** Topphand Enterprises (No. 14037 → 48,000.00), Tozen Philippines
  (SI000003966 → Amount Due 11,212.00), Rite Products (37966 → 8,078.02), Metal Exponents (100580 → 68,845.00),
  Taian (Subic) Electric (012047 → 35,620.00). All confirm the standing rule: the **VAT-inclusive gross** ("Total
  Sales (VAT Inclusive)" / "Total Amount Due" / "Amount Due") goes into the reconciliation **Actual** column.
- **New — alphanumeric invoice serials:** Tozen's SAP serial is **"SI000003966"** (2 letters + 9 digits). Broadened
  the invoice-number rule from "4–8 digits" to a **4–9-char serial that may carry a letter prefix**, keeping every
  leading zero AND any letters; added Tozen serial-reading to the SAP/"SUPPLIER SALES INVOICE" section (it read the
  amount but never the No.) and dropped the "digits only" schema note. New worked serials: 14037, 37966, 100580, 012047.
- **New trap (c) — handwritten "PAID – CASH – ₱… / EWT ₱…":** Metal Exponents stamps the net-of-withholding CASH
  (68,230.00 = 68,845.00 − 614.69 EWT) by hand; the reader must still use the **printed VAT-inclusive Total Amount
  Due 68,845.00**, not the handwritten paid figure. (A "Less 2% COD Discount" already baked into 68,845.00 stays.)
- **Reinforced the withholding trap** with Rite Products (8,078.02 not 8,005.89 after "Less: Withholding Tax 72.13"),
  and the "no/blank withholding line → Total Amount Due = gross" case with Topphand (48,000.00) and Taian (35,620.00).
- **Tozen date:** use the invoice **"Date" (07/17/2026), not the Delivery Date** (already in the SAP section; added
  the worked value). **PDC exception:** for a post-dated-check invoice with a "Payment Due Date" (e.g. Rite "PDC 15
  DAYS / 06/12/2026"), book the due date as the receipt date.
- Both readers (`api/ai/read-receipt` + `read-cash-receipt`) updated in parallel. Prompt-only; typecheck + lint clean.

## 2026-08-13 · Dashboard — "Sales this month" now reconciles with the WON sales report
- **Owner report ("this are not tally"):** the "Sales this month" KPI (₱2,785,603.32) didn't match the WON
  sales report's GRAND TOTAL Value (₱2,626,932.12) — a ₱158,671.20 gap.
- **Root cause:** both use the same value basis (`payableTotal`) and the same confirmed-sale filter, but different
  *dates*. The dashboard booked each sale on `saleDate` (soldAt-first), while the P&L and the WON report book on
  `saleRecognitionDate` (PO date for Terms clients, else first payment date). A sale marked sold in one month but
  paid / PO-dated in another landed in different months on each screen. The dashboard's 6-month `createdAt` query
  window also dropped this-month sales sitting on older quotes.
- **Fix (`dashboard/sales-dashboard-body.tsx`):** the sales loop now dates each confirmed sale by
  `saleRecognitionDate` (new `saleBookDate` helper delegating to `@/lib/department-pnl`), the exact basis the WON
  report and P&L use. Widened the `quotation.findMany` scan from "last 6 months" to **all quotations** (matching
  the report, which iterates every quotation) so a sale recognised this month on an older quote still counts; the
  windowed charts (14-day bars, 30-day line/customers, 6-month trend) already self-limit by date so they're
  unaffected. Removed the now-unused `since6mo`.
- **Note:** `buildSalesReport` doesn't apply the test-mode cutoff while the dashboard does, so the two reconcile
  when test mode is off (no cutoff). Typecheck + lint clean; `next build` compiles & type-validates.

## 2026-08-13 · Purchasing — replenishments follow the full PO workflow
- **Owner report (frozen Phase 4):** a replenishment (stock top-up) skipped the PO — it jumped from Approved
  straight to "Voucher & Check Prepared". Once approved, the Purchaser should make a PO and it should follow the
  same chain as every other request.
- **Server** (`advancePurchaseRequest`): dropped the `pr.kind !== "replenishment"` exemption from the voucher
  PO-gate, so the voucher now waits for a PO for replenishments too (like every kind).
- **Rendering:** replenishments now render through the **same `PurchasingChain`** as department requisitions —
  giving them the Create-PO button, PO panel, voucher/cash chain, reconciliation, and receive. `page.tsx` builds
  `replenRows` via `buildPurchaseChainRow` (was a minimal row) and a parallel `replenScan` list. The dedicated
  **"Scan to receive"** quick box is kept (owner asked): `replenishment-list.tsx` now exports a small
  `ReplenishmentScanBar` rendered above the chain; the old `ReplenishmentList`/`PRCard` is gone.
- **Label** (`purchasing-chain.tsx`): removed the `kind !== "replenishment"` exclusion from `requisitionAwaitingPO`
  so an approved-but-PO-less replenishment reads "Approved — awaiting Purchase Order".
- `savePurchaseOrder` / `canPreparePO` already work for non-dept requests, so the Purchaser can create the PO at
  APPROVED. Typecheck + lint clean; `next build` compiles & type-validates.

## 2026-08-13 · Receipt reader — more suppliers, Collection Receipts, 7-digit No., EWT rule confirmed
- **Owner lessons (5 receipts):** Alloymaster, Ideal Controls (7-digit No. 0001877), International Spring, JSL
  Electric (all sales invoices → VAT-inclusive gross into Actual), and DJC-Serv (a **Collection Receipt**).
- **EWT contradiction resolved:** TKL/DJC said use the gross (before withholding); JSL cited the after-withholding
  total. Owner confirmed **always the VAT-inclusive gross (before EWT)** — the prompt already did this; added JSL
  (16,295 not 16,149.51) as a second worked example next to TKL.
- **Prompt updates (`api/ai/read-receipt` + `read-cash-receipt`):** cover "CHARGE SALES INVOICE"; added the new
  supplier examples; broadened the invoice No. to **4–8 digits, keep leading zeros** (e.g. 0001877); added the
  "4-17-26" date format; and added a **COLLECTION / ACKNOWLEDGEMENT RECEIPT** section (DJC-Serv): read the red
  serial + date, and gross the "TOTAL PAYMENT" (net of 1% EWT) back up — receiptTotal = TOTAL PAYMENT × 1.12 ÷
  1.11 (× 1.12 ÷ 1.10 for 2% services), worked example 23,785.71 → 24,000.00, with a verify warning.
- Prompt-only; typecheck + lint clean.

## 2026-08-13 · Receipt reader — VAT-inclusive gross (withholding-tax trap) + cash reader
- **Owner lesson (TKL Steel invoice):** the Actual should be **"Total Sales (VAT Inclusive)" = 12,840.00**, NOT
  the final "Total Amount Due" 12,725.36 — that has "Less: Withholding Tax 11.64" subtracted, and EWT is a
  creditable tax remitted to BIR (2307), not a cost reduction. Also: read invoice No. 954314 and date 12-Aug-26.
- **Amount rule reworked (`api/ai/read-receipt`):** the booklet-invoice amount now anchors on the **VAT-inclusive
  gross** ("Total Sales (VAT Inclusive)" = VATable + VAT = Σ body AMOUNT column). Two explicit traps: (a) don't
  use the mid "Amount Net of VAT" (VAT-exclusive); (b) don't use a "Total Amount Due" with "Less: Withholding
  Tax" subtracted — use the VAT-inclusive gross (worked TKL example). Added TKL Steel + "Invoice No." / 12-Aug-26
  formats to the examples.
- **Cash-liquidation reader (`api/ai/read-cash-receipt`):** added the same PH SALES-INVOICE BOOKLET section
  (handwritten/printed, invoice No., date, lines, VAT-inclusive-gross with the same two traps) so the cash
  reconciliation autofills from these invoices too.
- Prompt-only; typecheck + lint clean.

## 2026-08-13 · Inquiries & Quotations — search by client email
- **Owner request:** allow searching by email address in the Inquiries and Quotations tabs.
- **Change:** added `customer.email` (insensitive `contains`) to the search `OR` in both list queries —
  `inquiries/page.tsx` and `quotations/page.tsx` (via `inquiry.customer.email`). Updated both search-box
  placeholders to mention "email". Existing customer/quote#/sales/status/source matching is unchanged.
- Typecheck + lint clean.

## 2026-08-13 · Receipt reader — cover printed booklets (Golden Pacific) + the net-of-VAT trap
- **Owner lesson:** a printed Golden Pacific sales invoice — 5-digit "No." (top-right), typed date
  (August 11, 2026), row 2 · ASAHI UCF208-24 · 750 · 1,500, and TOTAL AMT. DUE 1,500 → Actual.
- **Prompt refinement (`api/ai/read-receipt`):** generalised the booklet-invoice section from "handwritten" to
  **handwritten OR pre-printed** (Wings *and* Golden Pacific; columns QUANTITY | ARTICLES/DESCRIPTION | UNIT
  PRICE | AMOUNT). The invoice "No." may be red **or** black (4–6 digits); the date may be handwritten M/D/YY or
  typed in full. Key fix: use the **grand-total** row ("TOTAL AMOUNT DUE" / "TOTAL AMT. DUE", VAT-inclusive) and
  explicitly DON'T use the mid "AMOUNT DUE" / "Amount Net of VAT" line — on a VAT-inclusive PH invoice that's the
  net figure (e.g. 1,339.29 + 12% VAT 160.71 = 1,500.00 payable). Ignore Less-VAT / Withholding / VATable /
  Zero-rated / VAT-Amount rows.
- Invoice-number capture, dedup and display were already in place (#333); this is a reader-quality prompt-only
  change. Typecheck + lint clean.

## 2026-08-13 · Receipt reader — handwritten sales invoices + invoice-number dedup
- **Owner lesson:** the voucher-reconciliation AI reader must read a handwritten PH "sales invoice" booklet
  (e.g. Wings Commercial): (1) the red pre-printed serial "No." → invoice number; (2) the "Date" (M/D/YY);
  (3) the QTY / DESCRIPTION / UNIT PRICE / AMOUNT body rows; (4) "TOTAL AMOUNT DUE" → the Actual column
  (VAT-inclusive); (5) don't reuse the same sales-invoice number across different POs/vouchers.
- **Prompt (`api/ai/read-receipt`):** added a HANDWRITTEN / BOOKLET SALES INVOICE section to the SYSTEM prompt
  (read the red "No.", the handwritten date, the body columns, and use TOTAL AMOUNT DUE as the VAT-inclusive
  amount so the line actuals sum to it; handwritten figures on a *supplier* invoice are official — unlike bank
  slips). Added `invoiceNumber` to `receiptReadSchema` and the userPrompt JSON shape.
- **Dedup:** after a read, the route checks other purchase requests' reconciliations for the same
  `invoiceNumber` (Prisma JSON-path filter) and, if found, prepends a warning naming the other PO(s).
- **Store + show:** `Reconciliation` gains `invoiceNumber` (coerced); `recordReconciliation` persists it
  (preserving any prior); `PurchaseReconcileView`/`buildReconcileView` expose it; the reconcile panel captures
  the read number, passes it through, shows "SI No. …" in the header and in the AI read summary (with the date).
- Scope: purchase voucher-reconciliation reader only (the cash-liquidation reader is untouched). Display/reader
  quality + validation — non-workflow. Typecheck + lint clean; `next build` compiles & type-validates.

## 2026-08-13 · PO Summary — show the received-into-stock date
- **Owner request:** in the Purchase Orders — Summary card, show the date the Warehouseman received the item
  (pressed "Receive & Add to Stock"); visible to Purchaser, Admin and Payment Approver.
- **Change (display-only, non-workflow):** `PoSummaryRow` gains `receivedAt` / `receivedByName`; `my-dashboard.ts`
  populates them from the PurchaseRequest's `receivedAt` / `receivedByName` (the `receive` step), taking the most
  recent member receipt for a combined PO. The card (`my-dashboard/page.tsx`) shows a green
  "Received <date> · <name>" line when received. The card already renders for Admin / Payment Approver /
  Accounting / Purchaser, so no gating change was needed.
- Typecheck + lint clean; `next build` compiles & type-validates.

## 2026-08-13 · Purchasing — Create-PO & Split only after approval (hidden while pending)
- **Owner request (frozen Phase 4, explicit approval):** hide the "Create Purchase Order" and "Split
  (multi-supplier)" buttons while a request is in the **pending** tab; show them only once approved (in the
  **approved** tab). Apply to all roles and tabs.
- **Row** (`buildPurchaseChainRow`): new `canPreparePO` = `status === "APPROVED" && statusBucket(...) ===
  "approved"` — i.e. approved and out of the pending bucket (a dept MRF needs the Approver's `approve_po`).
- **Chain UI** (`purchasing-chain.tsx`): the **Create Purchase Order** button and the **Split (multi-supplier)**
  control now render only when `r.canPreparePO`; while pending they're hidden (Create-PO falls back to the
  "No purchase order yet." text). Read-only surfaces already hid them.
- **Server guards** (defense-in-depth, consistency): `savePurchaseOrder` and `splitPurchaseRequest` now refuse
  while the request is in the pending bucket (was: only `PENDING_APPROVAL`), so a dept MRF awaiting `approve_po`
  can't get a PO / be split until purchase-approved. Split still also blocks once past APPROVED.
- Typecheck + lint clean; `next build` compiles & type-validates.

## 2026-08-13 · Purchasing — Purchaser can reject a pending request
- **Owner request (frozen Phase 4, explicit approval):** add a Reject button for the Purchaser on pending
  purchasing requests (so they can turn away something they can't source), alongside the approving role's
  Approve/Reject.
- **Permission** (`advancePurchaseRequest`): the Purchaser is now allowed on the `reject` / `reject_po` steps in
  addition to the step's approving role (Payment Approver / Plant Manager) and admin.
- **Honest trail:** rejections now stamp the acting role. `reject` writes `chainLog.reject = {byName, at, role}`
  and `reject_po`/`approve_po` carry `role` too; `coerceChainLog` reads it and `buildPurchaseTrail` prefers it,
  so a Purchaser reject shows "(Purchaser)" — not the default approver designation. Backward-compatible
  (historical entries with no role fall back to the step's default title).
- **Row + UI:** `buildPurchaseChainRow` exposes `canPurchaserReject` (Purchaser role && the request is in the
  **pending** bucket — PENDING_APPROVAL, or a dept MRF Plant-Manager-approved but not yet purchase-approved).
  `purchasing-chain.tsx` renders a confirmed **Reject** button on the interactive chain for that case, picking
  `reject` (pending) or `reject_po` (approved-awaiting-purchase-approval), and de-duped against the approving
  role's own reject when the viewer holds both. Read-only surfaces (order page, requisitions) are unaffected.
- Typecheck + lint clean; `next build` compiles & type-validates.

## 2026-08-13 · Purchasing — approve first, PO after (flip the PO-before-approval gate)
- **Owner request (explicit approval to change the frozen Phase 4):** a pending purchase request must NOT
  require the Purchaser to create the PO first; approval happens while pending (no PO), and only once approved
  does the Purchaser make the PO. Apply across every flow, role and tab. Clarified: no second sign-off on the
  finished PO; keep today's "lock at approval" edit rule.
- **Core gate** (`orders/actions.ts` `advancePurchaseRequest`): `needsPo` reduced to **`stepKey === "voucher"`**
  — approve / reject / approve_po / reject_po no longer require a PO; the PO must exist by the voucher step.
- **`savePurchaseOrder`**: creating the first PO is always allowed post-approval (the old `isPoApproved` lock now
  only blocks *editing an existing* PO); a PO can no longer be prepared while the request is still
  `PENDING_APPROVAL` (must be approved first) — for every kind, not just dept.
- **Bulk approve** (`purchasing-workspace.tsx` `forwardStep`): only the voucher step waits on a PO.
- **Chain UI** (`purchasing-chain.tsx`): the "Create the Purchase Order first" hint + button-hide now apply to
  the **voucher** step only, so approval buttons show without a PO. Status labels reworked for the new order —
  dept MRF `APPROVED && !poApproved` → "Plant Manager approved — awaiting purchase approval"; any
  `APPROVED && !po` (post-approval) → "Approved — awaiting Purchase Order". Added `kind` to the chain row to
  exclude replenishments.
- **Order MRF badge** (`material-requests.tsx`): same reordering (awaiting-purchase-approval before awaiting-PO).
- **Dashboard** (`my-dashboard.ts`): the Purchaser's "Prepare Purchase Order" task now fires only once fully
  approved (`poApproved || !isDept`), so the Approver's `approve_po` task surfaces first.
- **Combined PO** (`createCombinedPO` + `purchasing/page.tsx` combinable + workspace `showBuilder`): combine
  **approved** PO-less requests (was pending), so batching also happens after approval — the combine builder now
  lives on the **Approved** tab.
- Updated the now-outdated `purchasing.ts` doc comments. `statusBucket` unchanged (still holds a dept MRF in
  Pending until `approve_po`). Typecheck + lint clean; `next build` compiles & type-validates.

## 2026-08-13 · Email marketing — recipient breakdown & A/B subject testing
- **Owner request:** add a per-campaign recipient breakdown (who opened / clicked) and A/B subject testing.
- **Recipient breakdown:** `resolveContacts(ids)` in `lib/marketing.ts` (customerId → company/contact/email).
  The results table became a client `campaign-results.tsx` — click a campaign row to expand **Opened** and
  **Clicked** contact lists. The page resolves all opener/clicker ids once and passes a contacts map down.
- **A/B subject testing:** new `AbTest` store (`marketing_abtests`) + CRUD in `marketing-store.ts`. Refactored
  the runner: extracted `deliverCampaign(recipients…)` as the shared send core (direct / scheduled / A/B all use
  it); `sendCampaign` is now a thin audience→deliver wrapper. `startAbTest` shuffles the audience, sends subject
  A and subject B to two halves of a test slice now (each its own tracked send record), and stores the tested
  ids + a `decideAt`. `runAbTests` (hourly cron, next to `runScheduledCampaigns`) picks the higher **open-rate**
  variant after the window and sends the winning subject to everyone not in the test slice.
- **UI:** builder gains an “A/B test the subject” toggle (Subject B, test-slice %, decide-after hours, Start).
  `campaign-activity.tsx` gains an **A/B subject tests** panel (per-variant opens, winner, remainder, cancel
  while testing) alongside the scheduled list and the drill-down results.
- **Actions:** `startAbTestAction`, `cancelAbTestAction`, `listAbTestsAction`; contacts resolved in `page.tsx`.
- Typecheck + lint clean; `next build` compiles & type-validates (unrelated `/reset-password` prerender needs
  Supabase env absent in the sandbox).

## 2026-08-13 · Email marketing — saved templates, scheduling & open/click tracking
- **Owner request:** add all three follow-ons to the campaign builder.
- **New `src/lib/marketing-store.ts`:** three AppSetting JSON stores (no schema change) + CRUD —
  `SavedCampaign` templates (`marketing_campaign_library`), `ScheduledCampaign` jobs (`marketing_scheduled`),
  `CampaignSendRecord` analytics (`marketing_sends`, capped 100). Best-effort `recordCampaignEvent` de-dupes
  open/click per recipient (a click implies an open).
- **Saved templates:** `upsert/delete/duplicate` helpers + actions; builder gets a library toolbar (load from a
  dropdown, Save as new / Update / Duplicate / Delete). The working draft is unchanged.
- **Schedule for later:** `addScheduledCampaign`/`cancelScheduledCampaign` + `scheduleCampaignAction`;
  `runScheduledCampaigns` in the runner fires due jobs; wired into the hourly cron **before** the follow-up
  schedule gate (so a scheduled campaign fires on its own timestamp regardless of the recurring-nudge schedule).
  Builder has a datetime-local + "Schedule send"; the activity panel lists upcoming/past with Cancel.
- **Open/click tracking:** `buildCampaignEmail` now embeds a 1×1 open pixel and wraps the CTA in a click
  redirect (`tracking` ctx, omitted for preview/test). New public `/api/marketing-track` route (gif for opens,
  validated redirect for clicks) records into the send record; added to middleware `PUBLIC_PATHS`.
  `sendCampaign` mints a `sendId`, personalizes tracking per recipient, and writes a `CampaignSendRecord`.
- **Results view:** new `campaign-activity.tsx` (scheduled list + delivered-campaign table with sent / opens
  (%) / clicks (%)) + `cancel-scheduled-button.tsx`; wired into `page.tsx`. Opens noted as approximate.
- Typecheck + lint clean; `next build` compiles & type-validates (unrelated `/reset-password` prerender fails
  only for lack of Supabase env in the sandbox). Both new routes are force-dynamic.

## 2026-08-13 · Email marketing — customizable campaign builder
- **Owner request:** a customizable email-marketing campaign with structured, editable "rows": sender name,
  benefit-focused subject, preheader, personalized greeting, opening hook, value prop, relevant products,
  benefits (not specs), visuals, social proof, one primary CTA, contact info, footer, unsubscribe. Bulk-send to
  selected clients; new Marketing page; uploaded images.
- **Approach:** extended the existing (basic) `/marketing` feature into a full section-based builder. Every
  section is optional (blank ⇒ dropped). Draft persists in an `AppSetting` (`marketing_campaign_draft`), no
  schema change.
- **New `src/lib/marketing-campaign.ts`:** `CampaignDraft` / `CampaignProduct` / `CampaignImage` types,
  `defaultCampaignDraft` (pre-filled from the request's examples + `COMPANY`), `normalize/get/setCampaignDraft`,
  `campaignImagePaths`, personalization tokens (`{firstName}`/`{contactName}`/`{company}` plus `[First Name]`
  bracket aliases) via `applyCampaignTokens`, and `buildCampaignEmail(draft, ctx)` → responsive, table-based,
  email-client-safe HTML + plain-text (hero image, greeting, hook, value prop, product cards, benefit bullets,
  gallery, social proof, CTA button, contact, dark footer, preheader span).
- **One-click unsubscribe:** `src/lib/marketing-unsubscribe.ts` (HMAC token under `CRON_SECRET`), public
  `/unsubscribe` page (confirm button → POST, so link prefetch can't opt anyone out) that sets the same
  `optOutFollowUp` flag campaigns/follow-ups already honour; `/unsubscribe` added to middleware `PUBLIC_PATHS`.
  Each email embeds a per-recipient unsubscribe link.
- **Images:** `/api/marketing-uploads` route (marketer-gated upload + signed-URL GET, `marketing/` scope) and
  `longLivedImageUrl` in `storage.ts` (~3-yr signed URLs embedded at send time, since recipients' mail clients
  fetch images unauthenticated later). Bucket stays private.
- **Runner (`marketing-runner.ts`):** `renderCampaignPreview` (personalizes for a sample client),
  `sendCampaign` (bulk to `list`/`all`, per-recipient personalization + unsubscribe link, opt-outs skipped,
  300/run cap, logs to the account conversation history), `sendCampaignTest` (one `[TEST]` copy). `senderFrom`
  now takes the campaign's sender-name override.
- **Actions (`marketing/actions.ts`):** `saveCampaignDraftAction`, `previewCampaignBuilderAction`,
  `previewCampaignRecipientsAction`, `sendCampaignBuilderAction`, `sendCampaignTestAction` (Zod-validated,
  `assertMarketer`). Removed the old free-text campaign actions (superseded).
- **UI:** new `campaign-builder.tsx` (client) — editor for every row (products & images add/remove, benefits as
  lines, image upload, token hints) with a **debounced live preview** rendered server-side into an iframe,
  test-send, audience selector + recipient count, and Send. `marketing-workspace.tsx` trimmed to the recurring
  check-in card; `page.tsx` renders the builder + recurring.
- Typecheck + lint clean; `next build` compiles & type-validates (the sandbox's unrelated `/reset-password`
  prerender fails only because no Supabase env is present here). `/unsubscribe` is force-dynamic.

## 2026-08-12 · Cash liquidation — admin per-line: delete a row + clear "Reconciled by hand"
- **Owner request:** (1) add a delete-row option to the admin per-line tally editor; (2) once an admin has
  tallied a voucher, remove it from the "Reconciled by hand" card.
- **Delete row (`cash-liquidation-panel.tsx`):** the admin "Edit per-line tally" table gets a trash-icon
  column — `removeAdminRow(i)` drops a line (disabled when only one line remains; server also enforces ≥1).
  Saving persists the reduced line set through the existing `adminEditCashLiquidationLines` (which recomputes
  `actualSpent`), so the P&L / tally follow automatically.
- **Clear from Reconciled-by-hand:** new `adminTally?: CashStamp` on `CashLiquidation`
  (`lib/cash-request.ts`, incl. coercion). `adminEditCashLiquidationLines` now stamps
  `adminTally = { byName, role: "Admin", at }` on save. `getManualReconciliations` (`lib/manual-reconciliations.ts`)
  excludes any cash liquidation carrying `adminTally` — an admin is an authorised manual-tally role, so once
  they've corrected it the voucher drops off the oversight card (its count decrements). The original
  `recordedByName/Role` is preserved, so the panel's "Liquidated by …" line is unchanged.
- Updated the admin-panel help note and the module doc comment. Typecheck + lint clean.

## 2026-08-12 · P&L books the actual liquidated spend (per-line edits flow through)
- **Owner request:** once the liquidation is edited per line, it should also reflect in the P&L.
- **Finding:** the P&L (`management/pnl-actions.ts`) booked every released cash voucher at `cr.amount` (the
  *released* figure), never the liquidated spend — so per-line edits (and any change-returned / overspend) never
  moved the P&L.
- **Change:** new `cashExpenseBooked(released, liquidation)` in `lib/cash-request.ts` — returns the **actual
  spend** (Σ line actuals) once liquidated, else the released amount; the released figure itself is untouched
  (still the liquidation's tally denominator). Applied at all three P&L cash-voucher sites (dept expense totals,
  Expenses report, expense records) and the Management-dashboard **Cash vouchers** mirror card
  (`lib/finance-monitor.ts`). Admin per-line edits already revalidate `/management`, so the P&L updates on save.
- **Effect:** for any liquidated voucher where spend differed from what was released, the P&L now books the
  real spend (correct expense). Balanced liquidations (spent == released) are unchanged. Updated the admin
  "Edit (admin)" note in `cash-request-list.tsx` to say the total is the *released* figure and the P&L uses the
  actual spend once liquidated.
- Typecheck + lint clean.

## 2026-08-12 · Cash liquidation — admin per-line tally edit (Planned + Actual)
- **Owner request:** add an option to edit the liquidation per line so it can be tallied — for a request whose
  total balances but whose per-line breakdown is off (and where the existing per-line editor is hidden because
  the request is already Settled).
- **Change (server, `cash-requests/actions.ts`):** new admin-only `adminEditCashLiquidationLines(id, lines)` —
  rewrites the liquidation's per-line `{description, budgetAmount, actualAmount}`, recomputes `actualSpent` from
  the edited actuals, and drops the receipt-verified (`aiVerified`) claim since the figures are now hand-typed.
  **Leaves the request at its current stage** (a Settled request stays Settled — in-place correction, not a
  re-liquidation). Revalidates `/cash-requests` + `/management`.
- **UI (`cash-liquidation-panel.tsx`):** admins get an **"Edit per-line tally (admin)"** button on any recorded
  liquidation (including Settled). Opens an editor with **Planned + Actual** inputs per line, a live per-line
  Diff and an overall released-vs-spent tally, and a "Save per-line tally" action. Non-admins are unaffected.
- Typecheck + lint clean.

## 2026-08-12 · Thank-you (Won/Lost) — "Send test" SMS in admin
- **Owner request:** add a "send test SMS" option to the Won and Lost thank-you editors so the SMS details /
  appearance can be checked before real sends (mirrors the "Send test email" from #321).
- **Change:** new `sendTestThankYouSmsAction({ outcome, toNumber, sms })` in `admin/actions.ts` — mirrors
  `sendTestSmsAction`: assertAdmin, requires SEMAPHORE_API_KEY, validates the PH mobile via `normalizePhMobile`,
  builds the message via `buildThankYouSms` with sample tokens (Sample Client Corporation / TEST-0001 /
  ₱125,000 / quote.appUrl/q/sample-quote), prefixes with a "[TEST WON/LOST]" notice, sends via Semaphore, and
  returns the account balance (`SmsTestResult`). Uses the **form's current SMS copy** so unsaved edits test.
- **UI (`admin/thank-you-setting.tsx`):** each side editor (Won / Lost) now has a "Send a test SMS" row — a
  tel input (placeholder `09171234567`) + "Send test SMS" button + success/error message showing the balance.
  `ThankYouSetting` gains `onTestSms`; wired in `admin/page.tsx`.
- Typecheck + lint clean.

## 2026-08-12 · Thank-you (Won/Lost) — "Send test" email in admin
- **Owner request:** add a "send test email" option to the Won and Lost thank-you editors so the appearance
  can be checked before real sends.
- **Change:** new `sendTestThankYouAction(outcome, toEmail, subject, body)` in `admin/actions.ts` — mirrors
  `sendTestFollowUpAction`: assertAdmin, requires RESEND key + FOLLOW_UP_FROM_EMAIL, builds the email via
  `buildThankYouEmail` with sample tokens (Sample Client Corporation / TEST-0001 / ₱125,000 /
  quote.appUrl/q/sample-quote), prefixes subject/body with a "[TEST WON/LOST thank-you]" notice, sends via
  Resend. Uses the **form's current copy** so unsaved edits can be tested.
- **UI (`admin/thank-you-setting.tsx`):** each side editor (Won / Lost) now has a "Send a test email" row —
  email input (defaults to the admin's email) + "Send test" button + success/error message. `ThankYouSetting`
  gains `onTest` + `defaultTestEmail`; wired in `admin/page.tsx`.
- Typecheck + lint clean.

## 2026-08-11 · Cash requests — Accounting can raise for any department
- **Owner request:** give Accounting access to all departments in the Cash Requests tab.
- **Finding:** Accounting already *sees* all departments' requests (it's a `finance` role → `where: {}`). The
  gap was the **department picker on the cash-request form** — Accounting was locked to its own department.
- **Change:** added `accounting` to the "pick any of the 5 departments" group in both the page
  (`cash-requests/page.tsx` `plantMgrDepts`) and the server enforcement (`cash-requests/actions.ts`
  `canPickAnyDept`), so Accounting can now raise/tag a cash request for any department (UI + server aligned).
- Typecheck + lint clean.

## 2026-08-11 · "Lost" tickbox on the quotation header
- **Owner request:** add a tick box on the quotation page; when ticked the quotation is recorded as LOST,
  follow-up email/SMS stop, but the lost thank-you is still sent.
- **How it works:** reuses the existing `markInquiryLost` / `reopenInquiry` actions (#315). Marking LOST sets
  the inquiry status → the follow-up runner already excludes WON/LOST (so nudges stop) and `markInquiryLost`
  fires the one-shot lost thank-you. Unticking reopens to SENT.
- **UI:** new `quotations/[id]/lost-quotation-toggle.tsx` (`LostQuotationToggle`) — a checkbox in the quotation
  header next to the status badge, with a confirm; optimistic + `router.refresh()`; hidden once the order is
  paid (Won). Added `inquiryId` + `inquiryStatus` to the builder `Quote` type and passed them from
  `quotations/[id]/page.tsx`.
- Typecheck + lint clean; build compiles.

## 2026-08-11 · Reorder + Purchaser Stock alerts — default to Low stock first
- **Owner follow-up:** show LOW-status items before OUT by default (Reorder list + purchaser Stock alerts card).
- **Reorder (`reorder-list.tsx`):** default Sort is now **Status, ascending** with `statusRank` Low=0/Out=1, so
  Low items lead, then Out. (Stock level / name / etc. still selectable.)
- **Stock alerts card (`low-stock.ts`):** `getLowStock()` now sorts Low (qty>0) before Out (qty<=0), name order
  kept within each — so the purchaser card's top rows are the Low items.
- Typecheck + lint clean.

## 2026-08-11 · Reorder page — search + sort + group + asc/desc (default: lowest stock first)
- **Owner request:** add a search bar, sort, group, and ascend/descend to the Reorder "Needs reordering"
  list; make the "low" selection the default view.
- **Change (`inventory/reorder/reorder-list.tsx`):** added client-side controls over the Needs list —
  **Search** (item name or category), **Sort** (Stock level / Item name / Reorder level / Status / Category),
  **Asc/Desc** toggle, **Group** (None / Category / Status). Default **Sort = Stock level, ascending** so the
  lowest / out-of-stock items surface first ("low selection as default"). Grouped view renders group-header
  rows in the same table; header count shows "N of TOTAL" when filtered. Bulk actions still act over all rows.
- Typecheck + lint clean.

## 2026-08-11 · Purchaser My Dashboard — stock cards (Low/out-of-stock count + Stock alerts list)
- **Owner request:** add the "Low / out of stock" count tile and the "Stock alerts" list to the Purchaser
  role's My Dashboard.
- **`src/lib/low-stock.ts`:** `getLowStock()` — active stock at/below reorder level (or zero), mirroring the
  finance-monitor computation (same `active:true` + alert-go-live scoping) so all dashboards agree.
- **`my-dashboard/stock-alerts-cards.tsx`:** presentational `StockAlertsCards` — a count tile (n +
  "needs reorder", PackageX, links to /inventory/reorder) + a "Stock alerts" list (top 7 items with Out/Low
  badges, "+N more"). Matches the finance-monitor styling.
- **Wiring (`my-dashboard/page.tsx`):** shown to the Purchaser (and admin) in the general branch, gated
  `isPurchaser && !finance` so Accounting (who already gets stock alerts via the finance-monitor row) doesn't
  double up. Rendered right after the count grid. Typecheck + lint clean.

## 2026-08-11 · Thank-you messages for Won / Lost clients (email + SMS, auto-send)
- **Owner request:** add an option to attach a thank-you message for won and lost clients. Chosen:
  **auto-send** on the Won/Lost transition, **Email + SMS**.
- **Config (`src/lib/thank-you.ts`):** `ThankYouConfig` (won/lost each: enabled + email subject/body + SMS)
  + shared `dryRun`, stored in AppSetting `thank_you_settings` (defaults OFF + dry-run ON, like follow-ups).
  Placeholders `{contactName}{company}{quoteNumber}{total}{salesName}{quoteUrl}`. `sendThankYou(inquiryId,
  outcome)` — one-shot, best-effort, NON-throwing: respects the per-client `optOutFollowUp`, idempotent via a
  new `accounts[cid].thankYou["<inquiryId>:won|lost"]` stamp, gated by dry-run + Resend/Semaphore config, logs
  a ConversationEntry. Email uses a branded shell; SMS via Semaphore.
- **Idempotency store:** added `thankYou?: Record<string,string>` to `AccountData` + preserved it in
  `parseAccounts` (registry coercion drops unknown fields).
- **Won hook:** `quotations/actions.ts` — after the sale flow sets inquiry WON (both the convert-to-sale toggle
  and record-sale), `await sendThankYou(inquiryId, "won")`. Non-blocking side-effect; no workflow change.
- **Lost setter (new):** there was NO UI to mark an inquiry LOST (`setInquiryStatus` was dead code). Added
  `markInquiryLost` / `reopenInquiry` actions (`inquiries/actions.ts`; lost fires the lost thank-you) and an
  `InquiryStatusControl` client component (Mark as lost / Reopen) beside the status badge on the inquiry page.
- **Admin UI:** `admin/thank-you-setting.tsx` card (won + lost editors, enable toggles, dry-run, placeholder
  chips, SMS segment counter) + `saveThankYouAction` (assertAdmin) + rendered on `/admin`.
- Typecheck + lint clean; production build compiles.

# Work log

A running record of completed work and open follow-ups, so a fresh Claude Code
session (which always starts with no memory of past sessions) can catch up fast
and we never redo something that's already done.

**How to use it**
- Newest entry on top.
- One block per task: what changed, why, the PR, and anything still pending.
- At the end of a task, say "log it" (or Claude adds an entry as part of finishing)
  and commit the change together with the work.
- A SessionStart hook prints the top of this file automatically at the start of
  every session — see `.claude/hooks/session-start.sh`.

---

## 2026-08-10 · Restore Accounting's reconciliation permission (revert #304/#305 gating)
- **Owner request:** restore the previous permission given to Accounting for reconciliation.
- **Change:** reverted the manual-tally gating added in #304 (Approver/Admin-only) and #305 (balance-aware)
  by restoring `src/app/(app)/orders/actions.ts` (`recordReconciliation`) and
  `src/app/(app)/purchasing/purchase-reconcile-panel.tsx` to their pre-#304 (0663e57) versions — the only
  commits that had touched them. Server gate is back to **admin OR purchaser/accounting/payment_approver**
  (no balance restriction, no `reconcileTotals` gate); panel `canManualRecord = hasAiRead || limitReached ||
  canApprove` (AI-read-first, with the original messages). Accounting can again record a manual tally
  regardless of balance.
- **Untouched:** the "Reconciled by hand" card and all its filters (#307–#313) and the collapsible Expenses
  card (#311) stay as-is. Typecheck + lint clean.

## 2026-08-10 · "Reconciled by hand" — apply the approved-discrepancy exclusion to CASH too
- **Owner-reported:** cash voucher 0000867 was liquidated by the requestor, its discrepancy approved and
  settled by Admin, yet it still showed. **Cause:** the approved-discrepancy exclusion was only in the PO
  loop; the CashRequest loop never checked the liquidation's `approval`.
- **Fix (`manual-reconciliations.ts`):** in the cash loop, also `continue` when `liquidation.approval` exists
  (`CashLiquidation` carries the same `approval`/`settled` stamps as PO reconciliation). Now an approved cash
  discrepancy drops off too.

## 2026-08-10 · "Reconciled by hand" — also exclude approved discrepancies (Approver or Admin)
- **Owner request:** drop from the list any reconciliation whose discrepancy has been approved. First
  scoped to Admin-approved; owner then extended it to **Payment Approver too**.
- **Change (`manual-reconciliations.ts`):** skip a PO row when `reconciliation.approval` exists (the
  discrepancy was authorised by the Payment Approver or an Admin → handled). Live filter, applies to future
  ones automatically. (Note: the 14 that remained were all Accounting/Requestor with no Admin-only approval;
  broadening to any approval is what actually reduces the count.)

## 2026-08-10 · "Reconciled by hand" — exclude Admin / Payment Approver tallies
- **Owner request:** the list should not include items tallied by an Admin or the Payment Approver (they're
  the authorised manual-tally roles for unbalanced records) — surface only hand-tallies by everyone else.
- **Change (`manual-reconciliations.ts`):** skip any row whose `recordedRole` ∈ {"Admin", "Payment Approver"}
  in both the PurchaseRequest-reconciliation and CashRequest-liquidation loops. The count reflects the
  filtered list. Typecheck + lint clean.

## 2026-08-10 · "Reconciled by hand" — include cash vouchers + deep-link to the item
- **Owner request:** the card should include **all** hand-tallied items (POs, requisitions, cash vouchers),
  and each row should open **that item in its own tab**: a PO → Purchasing tab on that PO; a cash voucher →
  Cash Requests tab on that voucher.
- **Data (`manual-reconciliations.ts`):** now scans **both** sources — `PurchaseRequest.reconciliation`
  (kind `PO` / `Requisition` via `isDeptRequisition`) **and** `CashRequest.liquidation` (kind `Cash`), each
  filtered to recorded + `aiVerified !== true`. Unified `ManualReconRow { kind, ref, title, amount,
  recordedLabel, href }`, newest-first.
- **Deep-links (existing highlight mechanisms):** PO/requisition → `/purchasing?req=<prId>` (opens the tab,
  scrolls to `req-<id>`, pulses the ring); cash → `/cash-requests?id=<crId>` (opens the tab, scrolls to
  `cr-<id>`, highlights).
- **Card:** kind badge (PO/Requisition/Cash) per row; rows are `next/link` to the deep-link target. Typecheck
  + lint clean.

## 2026-08-10 · "Reconciled by hand" — single-row tile, working PO link (404 fix)
- **Owner follow-ups:** (1) AI-first flow confirmed (AI reads + autofills; unbalanced → only Admin/Approver
  manual tally) — already the behavior, no change. (2) Put the tile on the **same row** as the other count
  cards. (3) The list link **404'd**.
- **Single row:** `ManualReconcileCard` now returns a Fragment — the tile is a **grid cell** (rendered inside
  the count grid, so it's the 6th tile on one row) and the expanded list is **`col-span-full`** beneath the
  row. `page.tsx` renders `{manualReconCard}` inside the grid and the grid shows when byArea OR the card has
  content.
- **404 fix:** `/purchasing/po/{prId}` has no page — only `/view` + `/xlsx` route handlers. Link now targets
  `/purchasing/po/{prId}/view` (the PO HTML doc), opened in a new tab via a real `<a target="_blank">`. Same
  bug fixed on the **management Cash Vouchers card** (PO rows → `window.open(.../view)`; cash rows keep
  `router.push`). Typecheck + lint clean.

## 2026-08-10 · "Reconciled by hand" card + restrict manual reconcile to Approver/Admin (Phase 4, owner-approved)
- **Owner request (Production Dashboard):** add a count of vouchers reconciled by hand (typed figures, not
  AI-verified against the receipt); clicking the card expands the list inline. Also: **disallow Accounting
  from reconciling manually**, and stamp name/designation/date/time on a manual tally.
- **Count card (display-only):** `src/lib/manual-reconciliations.ts` `getManualReconciliations()` — PRs whose
  reconciliation `isReconciled` + `aiVerified !== true` + has `recordedAt` (i.e. typed by hand). Returns PO
  no., supplier, amount, and "Name (Designation) · date time". New client tile
  `my-dashboard/manual-reconcile-card.tsx` (matches the stat-tile look; click → **expand inline** list, rows
  link to the PO). Wired into `my-dashboard/page.tsx` after the count grid, shown to Admin / Payment Approver /
  Accounting. Frozen Phase 3 MRF feed untouched (separate lib + card).
- **Gating (frozen Phase 4, owner-approved) — balance-aware (refined per owner):** a **manual** tally
  (`aiVerified !== true`) that **balances** may be recorded by anyone allowed to record (incl. Accounting &
  Purchaser); an **unbalanced** manual tally (a discrepancy) is restricted to the **Payment Approver or an
  admin**. `recordReconciliation` computes `reconcileTotals(lines, vatMode).status` and throws only when
  `manual && !balanced && !approver/admin`. Panel `purchase-reconcile-panel.tsx`:
  `canManualRecord = canApprove || admin || previewBalanced` (previewBalanced from `balanceTolerance`); the
  Record button + hint enforce the discrepancy restriction live as figures are typed. AI receipt-read path
  (`aiVerified=true`) unaffected.
- **Name/designation/date/time** were already captured (`recordedByName`/`recordedRole`/`recordedAt`) and shown
  ("Reconciled by …"); now also surfaced in the new card. Typecheck + lint clean; app compiles.

## 2026-08-10 · Receipt-reading reference doc (Petron + S.I.# duplicate rule)
- **Owner supplied** a Petron fuel Sales Invoice as "training for future reference": Total = number right
  of `TOTAL`; refill date = `Date:` row (NOT the bottom "Date Issued" accreditation/PTU dates); sales
  invoice no. = `S.I.#` row; same `S.I.#` = the same receipt being re-uploaded.
- **Action (owner chose "document only"):** wrote `docs/receipt-reading.md` capturing the Petron reading
  rules, the date trap, and the desired **S.I.# duplicate-block** (reject reusing an S.I.# across
  reconciliations/liquidations — owner wants it on **both** readers when built).
- **Not implemented:** neither `read-receipt` (PO reconcile) nor `read-cash-receipt` (cash liquidation)
  extracts the S.I.# or dedups today; that's a **frozen Phase 4** change needing owner approval. Doc only —
  no code/workflow change.

## 2026-08-10 · Management Cash Vouchers card — collapsible, clickable rows, real status (owner-approved)
- **Owner request:** make the Cash Vouchers card collapsible + rows clickable, and show the real status
  (Settled / Liquidated / etc.) instead of a generic "Cash voucher" badge.
- **Change:** extracted the management page's inline card into a client component
  `management/cash-vouchers-card.tsx` (`CashVouchersCard` + `CashVoucherView`). It's **collapsible**
  (default collapsed; header shows "N not tallied · M awaiting · K cash · ₱total"), **rows are clickable**
  (router.push → cash rows open `/cash-requests/{id}/voucher`, PO rows `/purchasing/po/{prId}`), and cash
  rows show a **status badge** (SETTLED→success, LIQUIDATED→default, else secondary) with a short label
  (Released / Handed over / Received / Liquidated / Settled). The page now builds `CashVoucherView[]`
  (adds `id` to the cash query) and renders the component.
- Display-only enhancement to the frozen Phase 4 reporting surface (owner-approved) — no workflow change.
  Typecheck + lint clean.

## 2026-08-10 · Management Cash Vouchers card — include released cash-request vouchers (Phase 4, owner-approved)
- **Owner-reported:** the Management **"Cash Vouchers"** card said "No cash vouchers printed yet" while
  the Expenses report listed cash vouchers (0000845–0852, Office expenses).
- **Cause:** the card only read `getPrintedVouchers()` (PO-based vouchers printed from Purchasing);
  those Office vouchers are **released cash requests** (`cashRequest`), a different source.
- **Change (owner picked option C, explicitly approved in-conversation — this is a FROZEN Phase 4
  cash-voucher/management-tally surface):** `getFinanceMonitor` now also includes released cash-request
  vouchers. `VoucherRow` gains `kind: "po" | "cash"`. PO rows keep the exact tally/mismatch/reconcile
  logic; cash rows (released statuses CASH_RELEASED/DISBURSED/RECEIVED/LIQUIDATED/SETTLED, same go-live
  `createdAt` scope as the P&L) show `approvedTotal = total` and a neutral **"Cash voucher"** badge.
  Card header count now reads "(N not tallied · M awaiting · K cash)"; the mismatch detail line is
  PO-only. Merged list sorted by printedAt desc.
- Typecheck + lint clean. Only the voucher *reporting* surface changed — no change to who acts, gating,
  step order, stage progression, or how vouchers are created/printed.

## 2026-08-10 · My Dashboard — fix amount mismatch (show payable, not gross)
- **Owner-reported:** an order showed a different price on **My Dashboard → Pending Your Action**
  (₱1,333,114.72) vs the **order page** header (₱1,106,961.33).
- **Cause:** the dashboard feed used the raw `quote.total` (gross, pre-discount) while the order page,
  orders list, and quotation page all use `payableTotal(quote)` (after discount + VAT mode). The
  dashboard was the lone outlier.
- **Fix (display-only):** `src/lib/my-dashboard.ts` now uses `payableTotal(...)` for both the **Orders**
  pending-action feed and the **Quotations awaiting approval** feed. No change to who acts, gating, step
  order or stage progression — **non-workflow display fix** (both queries already `include` the full
  quotation, so `total/discountPct/vatMode/classification` are available). Typecheck + lint clean.

## 2026-08-10 · Follow-ups — SMS reach indicator ("X of Y clients have a valid mobile")
- **Owner request:** show how many follow-up clients the SMS channel can actually reach.
- **`src/lib/sms-reach.ts`:** `getSmsReach()` — over the SMS universe (distinct clients with an open,
  non-won/lost SENT quote), counts how many have a valid mobile via the **same** `normalizePhMobile`
  the sender uses, so it reflects exactly who a live run would text. Returns `{ total, withMobile }`.
- **Admin UI:** the SMS section shows **"Reach: X of Y follow-up clients have a valid mobile number (NN%)"**
  under the sender/balance line, noting the remainder are skipped automatically (or "No open sent quotes
  to text yet." when empty). Wired via a `smsReach` prop from the admin page.
- Typecheck + lint clean. **Non-workflow (CRM) — no order-workflow / P&L change.**

## 2026-08-10 · Follow-ups — per-nudge SMS messages (like the per-nudge emails)
- **Owner request:** custom SMS text per nudge, same as the email per-nudge templates.
- **Change:** SMS setting `smsTemplate` (single string) → **`smsTemplates: string[]`** (one per nudge).
  Normalize migrates any legacy single value into slot 1. New `smsTemplateForNudge(list, n)` +
  `DEFAULT_FOLLOWUP_SMS_TEMPLATES` (3 defaults) in `follow-up-sms.ts`; runner picks the message for
  each nudge. Blank row → that nudge's built-in default.
- **Admin UI:** SMS section now shows **one message box per nudge** (count follows Max nudges) with a
  per-row char/credit hint, and the **Send test SMS** gained a **nudge picker** so you can preview each
  nudge's text. `saveFollowUpSmsAction` takes `smsTemplates`; `sendTestSmsAction(number, nudge)`.
- Typecheck + lint clean. **Non-workflow (CRM) — no order-workflow / P&L change.**
- Note: still blocked on Semaphore **sender-name approval** (AEROVENTFAN pending) before any live send —
  the "No active sender name found" error is external to the app.

## 2026-08-10 · Follow-ups — SMS channel via Semaphore (independent of email)
- **Owner request:** add SMS follow-ups through Semaphore (semaphore.co). Owner chose **"SMS only /
  separate channel"** — leave the email flow untouched, run SMS as its own independent channel to any
  due client who has a phone number.
- **Client (`src/lib/sms/semaphore.ts`):** HTTP wrapper over Semaphore v4 — `smsConfigured()`,
  `sendSms()`, `normalizePhMobile()` (→ `09XXXXXXXXX`, handles +63/63/9 forms, rejects non-mobiles),
  `getSemaphoreBalance()`. Reads `SEMAPHORE_API_KEY`; optional `SEMAPHORE_SENDER_NAME` (config).
- **Message (`src/lib/follow-up-sms.ts`):** single editable template (not per-nudge — SMS is short),
  `buildFollowUpSms()`, `DEFAULT_FOLLOWUP_SMS`, same `{placeholders}` as email (+ `{quoteUrl}`),
  `smsSegments()`.
- **Runner:** new **independent SMS pass** in `runFollowUps` — same cadence engine, but tracked in a
  separate `classification.followUp.smsSent` array (via new `smsNudgesSentFrom` / `lastSmsAtFrom`), own
  `smsEnabled` + `smsDryRun` + `smsMaxPerRun` gate, records channel "SMS" on the quote + conversation
  history. Result gains `smsDue/smsSent/smsPreviewed/smsSkipped`; `RunItem` gains `channel`. Email path
  is unchanged.
- **Settings:** `smsEnabled` (OFF), `smsDryRun` (ON), `smsMaxPerRun` (24), `smsTemplate` + normalize.
- **Admin UI:** new **"SMS follow-up (Semaphore)"** section — sender + credit-balance display, editable
  message, per-run cap, enable + dry-run switches, live/off banner, and a **Send test SMS** to any
  number (`sendTestSmsAction`), plus `saveFollowUpSmsAction`. Preview run now shows SMS due/would-text.
- Opt-out reuses `optOutFollowUp`. `.env.example` documented. Typecheck + lint clean.
  **Non-workflow (CRM) — no order-workflow / P&L change.** Needs a Semaphore account + `SEMAPHORE_API_KEY`
  in Vercel to actually text; starts OFF + dry-run for safe testing.

## 2026-08-09 · Follow-ups — configurable send schedule (daily at hour / every N hours)
- **Owner request:** a time picker to control when auto follow-ups send — per day at a chosen time, or
  every N hours.
- **Cron:** `vercel.json` cron changed from daily (`0 1 * * *`) to **hourly** (`0 * * * *`). The route
  (`api/cron/follow-ups`) now gates each hourly fire with `shouldRunScheduler(settings, now)` + a stored
  `lastRunAt`, so it only sends on the chosen schedule; `?force=1` bypasses the gate for manual runs.
  ⚠️ **Hourly cron needs a Vercel plan that allows it (Pro);** on Hobby the cron is once/day so only the
  daily mode fires (a failed build from an unsupported schedule doesn't affect the live site — revert
  the one line to `0 1 * * *`).
- **Settings (`follow-up-settings.ts`):** `scheduleMode` (`daily`|`interval`), `sendHour` (0–23 Manila,
  default 9), `intervalHours` (1–24, default 24), internal `lastRunAt`. Helpers `shouldRunScheduler`,
  `scheduleLabel`, `hourLabel`.
- **UI:** admin **"Send schedule"** section (Once a day at <hour> / Every N hours) + `saveFollowUpScheduleAction`
  (merges over current). The `/follow-ups` live banner now shows the real schedule via `scheduleLabel`.
- Typecheck + lint clean. **Non-workflow (CRM/email) — no order-workflow / P&L change.**

## 2026-08-09 · Follow-ups due — live-status banner (was hardcoded "Dry run")
- **Owner-reported:** turned Automatic ON / Dry-run OFF in Admin, but the Follow-ups page still showed
  a hardcoded **"Dry run — nothing is sent automatically"** notice — misleading.
- **Fix:** `/follow-ups` page now computes the real status (`enabled && !dryRun && Resend configured`)
  and shows a green **"Live sending is ON — daily ~9:00 AM Manila, up to {maxPerRun}/run"** banner when
  live, or an accurate off/not-connected message otherwise. Typecheck + lint clean. **UI only — no
  workflow / P&L change.** (Send-time configurability tracked separately.)

## 2026-08-09 · Follow-ups — plain email format (land in Primary, not Promotions)
- **Owner-reported:** the follow-up landed in Gmail's **Promotions** tab.
- **Cause:** the big styled "View your quotation" CTA button + heavy HTML read as marketing.
- **Fix (owner chose "plain & personal"):** in `follow-up-email.ts`, replaced the colored button with a
  plain inline text link ("You can view your quotation here: <url>"), dropped the `<hr>`, and reduced the
  signature/wrapper styling (no button, no `<em>`, minimal inline CSS) so it reads like a 1-to-1 email —
  the strongest lever for Primary placement. Applied to both the quote follow-up and inquiry check-in.
  **Subjects/messages left to the owner** (their custom templates untouched). Typecheck + lint clean.
  **Email format only — no workflow / P&L change.**

## 2026-08-09 · Follow-ups — test email to any address (warm-up different inboxes)
- **Owner need:** the "Send test email" button always went to the admin's own account; they want to
  send test follow-ups to other mailboxes to warm up the domain.
- **Added:** `sendTestFollowUpAction(nudge, toEmail?)` now accepts a recipient (validated with
  `z.string().email()`), defaulting to the admin's own address; reply-to stays the admin. Admin card
  got an **email input** next to the nudge picker (prefilled with the admin's email via new
  `defaultTestEmail` prop; `admin/page.tsx` passes `getCurrentUser().email`); button relabeled
  "Send test email". Still admin-only, still bypasses the client list. Typecheck + lint clean.
  **Non-workflow admin utility — no order-workflow / P&L change.**

## 2026-08-09 · Follow-ups — backlog "campaign" (start whole backlog today, no cascade)
- **Owner need:** kick off follow-ups for the whole ~625 open-sent-quote backlog *today* (24/day via
  the per-run cap), not just the handful that happen to cross a cadence day.
- **Engine (`follow-up.ts`):** `evaluateFollowUp` gains `campaignStartAt` + `lastSentAt`. First nudge is
  due at `max(sentAt + offsets[0], campaignStart)` — so old quotes all become due on the start day while
  fresh quotes still wait their offset. **Subsequent** nudges are spaced by the cadence interval from the
  **last actual send** (`lastSentAt`) instead of from the quote date — so a client reached late in a
  throttled backlog is never hit with several nudges at once. Fully backward-compatible when both are
  absent. New helper `lastNudgeAtFrom()`.
- **Setting:** `campaignStartAt` (ISO or null) on `FollowUpConfig`. Admin action
  `setFollowUpCampaignAction(start)` sets it to start-of-today / clears it; `saveFollowUpSettingsAction`
  now merges over current so it isn't wiped by a cadence save.
- **Wiring:** runner + `/follow-ups` page pass `campaignStartAt` + per-quote `lastSentAt`. Admin card
  gets a **"Backlog follow-up campaign"** Start/Stop control with status (`follow-up-setting.tsx`,
  `page.tsx`).
- **Usage:** Start campaign + Max emails per run 24 + enable sending → the backlog goes out 24/day
  (no-email clients skipped), each client's later nudges spaced from their own first send.
- Typecheck + lint clean; unrelated pre-existing `selection.test.ts` fan-motorPole failure only.
  **Non-workflow (CRM/email) — no order-workflow / P&L change.**

## 2026-08-09 · Follow-ups due — search / group / sort toolbar (matches other lists)
- **Owner request:** add search, group, sort (asc/desc) to the Follow-ups due list, same look &
  behavior as the other tables.
- **Added** to `due-table.tsx` the same toolbar pattern as `orders-table.tsx`: a **search** box (client /
  contact / email / phone / quote no. / sales, separator-insensitive quote match), **Group by**
  (Client / Sales / Nudge) with group-header rows, **Sort by** (Days waiting / Sent date / Amount /
  Client / Nudge / Sales) and an **Asc/Desc** toggle; "N shown" count and an empty-state row. Selection
  + "Send to selected" still work (select-all now targets the filtered rows). Page passes numeric
  `amount` + `sentMs` for sorting (`page.tsx`). Typecheck + lint clean. **Non-workflow — no
  order-workflow / P&L change.**

## 2026-08-09 · Follow-ups — hand-pick recipients ("Send to selected" warm-up)
- **Owner need:** choose exactly which clients to email (not just an oldest-first batch) to warm up the
  new sending domain gradually.
- **Added:** `runFollowUps` now accepts `onlyQuoteIds` (restrict the send to specific quotes; skips the
  inquiry pass + ignores the per-run cap) and `ignoreEnabledDryRun` (manual send bypasses the
  scheduler's on/off + dry-run, still needs Resend keys). New admin-only action
  `sendSelectedFollowUpsAction` (`follow-ups/actions.ts`). The **Follow-ups due** page table is now a
  client component (`due-table.tsx`) with **checkboxes + "Send to selected (N)"** for admins (email-less
  rows disabled; confirm before sending; shows sent/skipped/errors); non-admins keep the read-only list.
  Typecheck + lint clean. **Non-workflow — no order-workflow / P&L change.**

## 2026-08-09 · Follow-ups — new email closing & signature
- **Owner request:** replace the follow-up email's closing/sign-off with the new wording — closing
  "Thank you for giving Aerovent Fans and Blowers Manufacturing the opportunity to submit our
  proposal. We look forward to assisting you on this or any future project.", sign-off **Best regards,**,
  then name / **Aerovent Fans and Blowers Manufacturing** / *Engineering Superior Airflow Solutions*.
- **Scope guard:** `COMPANY.closing/signoff/signatory` are shared with the **quotation PDF / XLSX** and
  marketing, so those were **not** touched. Instead added **local** `EMAIL_*` constants +
  `emailSignatureText/Html()` helpers in `follow-up-email.ts` and used them in **both** the quote
  follow-up and the inquiry check-in builders. Quote/marketing documents unchanged. Typecheck + lint
  clean. **Email copy only — no workflow / P&L change.**

## 2026-08-09 · Follow-ups — "Max emails per run" throttle (warm-up / batch size)
- **Owner need:** with ~48 clients due, send only a batch (e.g. 24) per run instead of all at once —
  a domain warm-up control.
- **Added:** `maxPerRun` to `FollowUpConfig` (`follow-up-settings.ts`, default 100 = the hard ceiling,
  `FOLLOW_UP_MAX_PER_RUN`). The runner (`follow-up-runner.ts`) now caps sends at `settings.maxPerRun`
  (quote follow-ups + inquiry check-ins share the budget) instead of the old hardcoded 100; oldest due
  first, the rest stay due for the next run. Admin cadence card gets a **"Max emails per run"** input
  + warm-up note (`follow-up-setting.tsx`); schema + wiring updated (`admin/actions.ts`, `page.tsx`).
  Typecheck + lint clean. **Non-workflow — no order-workflow / P&L change.**

## 2026-08-09 · Follow-ups — fix duplicate greeting (message owns the greeting)
- **Owner-reported:** the sent email showed **"Dear <name>," twice** — the shell auto-added a greeting
  and the admin's custom message *also* began with its own greeting.
- **Fix:** removed the auto **"Dear …,"** from the branded shell in `buildFollowUpEmail` (text + html);
  the greeting is now part of the editable message. Added `Dear {contactName},` to the three
  `DEFAULT_FOLLOWUP_TEMPLATES` so un-customized nudges still greet. Updated the editor helper text
  (`follow-up-templates-setting.tsx`) to say include your own greeting; the button / signature /
  opt-out stay automatic. Typecheck + lint clean. **Email copy only — no workflow / P&L change.**

## 2026-08-09 · Follow-ups — editable per-nudge email content (Admin)
- **Owner request:** give each follow-up nudge its own wording (same branded design), editable in
  Admin.
- **Design:** the branded shell (greeting → body → **View your quotation** button → signature →
  opt-out) is generated automatically; only the **subject + message body per nudge** are editable, so
  every nudge stays visually consistent while the copy escalates (reminder → value → gentle urgency).
- **Added:**
  - `FollowUpTemplate` type, `DEFAULT_FOLLOWUP_TEMPLATES` (3 escalating), `templateForNudge()`,
    `FOLLOWUP_PLACEHOLDERS`, and a token substituter in `follow-up-email.ts`; `buildFollowUpEmail`
    now renders a per-nudge `template` (falls back to defaults — backward compatible).
  - `follow-up-templates.ts` — AppSetting persistence (`follow_up_templates`, no migration), defaults
    when unset.
  - Runner (`follow-up-runner.ts`) loads the templates and passes the right one per nudge.
  - Admin editor `follow-up-templates-setting.tsx` (+ `saveFollowUpTemplatesAction`) — one subject +
    message box per nudge (count follows Max nudges), with the placeholder list
    (`{contactName} {company} {quoteNumber} {projectName} {total} {validUntil} {salesName}`).
  - The "Send test email to me" button got a **Preview nudge #** picker so each nudge's design can be
    emailed to the admin; `sendTestFollowUpAction(nudge)` uses that nudge's template.
- Typecheck + lint clean. **Non-workflow (marketing email content) — no order-workflow / P&L change.**

## 2026-08-09 · Follow-ups — "Send test email to me" button (safe deliverability check)
- **Owner need:** verify the automated follow-up email (formatting + does it inbox on the new
  `aeroventfbm.shop` domain) **without** enabling live sending or emailing any client.
- **Added:** `sendTestFollowUpAction` (admin-only) in `admin/actions.ts` — builds the real
  `buildFollowUpEmail` template with representative sample data, prefixes the subject with `[TEST]`
  + a "sent only to you" note, and sends via Resend **to the logged-in admin's own address only**.
  Ignores the enabled/dry-run switches (never touches a client) but still requires the Resend key +
  sender to be set (clear error otherwise). Wired a **"Send test email to me"** button into the
  Admin follow-up card (`follow-up-setting.tsx`, `admin/page.tsx`). Typecheck + lint clean.
  **Non-workflow admin utility — no order-workflow / P&L change.**

## 2026-08-09 · All order workflows tested & locked — approval required for any workflow change
- **Owner sign-off:** all five phases' workflows have been tested end-to-end and are now
  considered verified/locked. Going forward, change a workflow **only** when the owner explicitly
  approves that specific change in the conversation — applies to every phase equally.
- **What counts as a workflow change (needs approval):** who acts on a step, the step order, the
  gating/role checks, or the stage progression. UI-only / copy / label tweaks are still fine.
- **Recorded in `CLAUDE.md`** (frozen-area intro) so every future session honors it. Doc only.

## 2026-08-09 · Pick-up approval button — POD → POP ("Proof of Pick up")
- **Owner request:** on pick-up orders the approval button read **"Approve POD - Successful Pick Up"**,
  but POD = *Proof of Delivery* — wrong for a pick up. Relabel the acronym to **POP** (*Proof of Pick
  up*) everywhere it refers to a pick up; delivery buttons stay **POD**.
- **Changed (pick-up branches only):** the single-flow `delivered` button + helper text
  (`fulfillment-actions.tsx` plant-pickup branch, `pickup-pod-form.tsx` office-pickup),
  the `pendingStep` "Waiting for" action for pick up (`order-workflow.ts`), the three multi-batch
  pick-up step labels (`delivery-multibatch.ts` — office / plant / bought-in pickup; the delivery
  variant keeps "Approve POD — successful delivery"), and the multi-batch panel's gate hint
  (`multi-batch-panel.tsx`). Delivery-mode labels untouched. Typecheck + lint clean. **Label only —
  no workflow / P&L change.**

## 2026-08-09 · Multi-batch delivery — 1st Quality Inspector can run the quality test
- **Owner-reported:** on a produced order in **multiple-batch delivery** (AFBM00003006R), the
  **"Quality Tested-Passed"** button was missing for a user assigned **1st Quality Inspector**;
  a refresh didn't help.
- **Root cause:** the per-batch quality-test step (`qa_tested`) in `delivery-multibatch.ts` was gated
  to **`technical_head` only**, whereas the single-batch `canQaTest` allows **Technical Head OR 1st
  Quality Inspector**. So a 1st QI could test a single-batch order but not a multi-batch one.
- **Fix:** `MBStepDef` gained an optional **`altRoles`** list (+ `mbStepRoles()` helper). The produced
  `qa_tested` step in `MULTIBATCH_STEPS` and `MULTIBATCH_PLANT_PICKUP_STEPS` now carries
  `altRoles: ["quality_inspector"]`; the from-stock variants (Warehouse test) explicitly strip it. The
  order page's `canAct` (`orders/[id]/page.tsx`) and the `advanceMultiBatch` server action
  (`orders/actions.ts`) now allow the actor if they hold **any** of the step's roles, and the
  "Waiting on …" label lists both. Bought-in / office-pickup (2nd QI) / stock (Warehouse) variants
  unchanged. Typecheck + lint clean. **No P&L change — workflow role gate only.**

## 2026-08-09 · Notifications — deep-link order / cash / schedule / commission alarms
- **Owner-requested follow-up (#1 + #2 from the purchasing fix):** make every remaining
  notification land on the pending action, not a generic list.
- **#1 Orders:** the 16 order-category `logActivity` hrefs now append **`#pending`** (`orders/actions.ts`),
  and the "Waiting for" status card got `id="pending"` + `scroll-mt-24` (`orders/[id]/page.tsx`), so
  order notifications scroll straight to the current action/approver.
- **#2 Cash / Schedule / Commission** (each page previously had no deep-link):
  - **Cash** (`?id=<id>`): `cash-requests/page.tsx` reads it; `cash-request-list.tsx` defaults to the
    **All** tab, scrolls to & highlights the row (`cr-<id>`). Hrefs → `/cash-requests?id=<id>`:
    `cash.request.submit` (now captures the created id) + `cash.<step>` (`cash-requests/actions.ts`)
    and the dashboard cash task (`my-dashboard.ts`).
  - **Schedule** (`?event=<id>`): `calendar/page.tsx` reads it; `schedule-calendar.tsx` opens that
    event's **detail drawer** on load (via `detailKey`), so the approver lands on the Approve action
    regardless of the calendar view. Hrefs → `/calendar?event=<id>`: `schedule.create` (captures id) +
    `schedule.<decision>` (`schedule-actions.ts`) and the dashboard schedule task.
  - **Commission** (`#commission-<id>`): `commissions/page.tsx` rows got `id` + `scroll-mt-24` +
    `:target` highlight. The dashboard commission task previously linked to the *source doc* (order /
    counter-sale) though "Mark paid" is on the Commissions page — now `/commissions#commission-<id>`,
    and `commission.paid/unpaid` (`commissions/actions.ts`) too.
- **Requisitions:** intentionally skipped — no notification/feed points at `/requisitions` (dept
  requisitions surface in the Purchasing tab, already deep-linked). Typecheck + lint clean. **No P&L
  / workflow change.**

## 2026-08-09 · Notifications — deep-link purchasing alarms to the exact request
- **Owner-reported:** clicking a notification doesn't land on the pending action, especially in the
  Purchasing tab. **Audit** (read-only agent) confirmed every `logActivity` has an href (all
  clickable), so the problem is **generic/wrong targets**: purchase notifications went to the
  **order page** (read-only — the purchaser acts in `/purchasing`) or a bare **`/purchasing`** list,
  and `/purchasing` had **no deep-link support** at all.
- **Fix (purchasing — the reported bug):**
  - `/purchasing` now accepts **`?req=<prId>`**: `purchasing/page.tsx` reads it; `purchasing-workspace.tsx`
    finds the request's bucket, **opens that tab** (or the Completed section), **scrolls to** the card
    and **pulses a highlight ring** (clears after 4s). Anchors added: `id="req-<id>"` on each
    `PurchasingChain` row (`orders/[id]/purchasing-chain.tsx`) and each combined-PO card
    (`combined-purchasing.tsx`), both accepting a `highlightId`.
  - Hrefs repointed to `/purchasing?req=<id>`: the `purchase.<step>`, `purchase.split` and supplier-
    return `logActivity` calls (`orders/actions.ts`) and the My Dashboard purchasing feeds
    (`my-dashboard.ts`): Prepare PO, purchase task (`pr:`), returns feed/task, PO summary row.
  - Typecheck + lint clean. **No P&L / workflow logic changed.**
- **Still generic (audit findings, not yet fixed — offered as follow-ups):** activity-bell **order**
  notifications land at the top of the order page (no `#phase-N` anchor; the My Dashboard order feed
  already anchors); **cash / schedule / commission / requisitions** pages have no deep-link support,
  so those feeds land on an unfiltered list.

## 2026-08-09 · Revision restore — re-point a quote to an earlier revision (Sales → Engineer/Admin)
- **Owner-requested:** a client sometimes settles on an earlier revision (e.g. buy on rev 1 after
  rev 2/3 exist). Owner chose: **re-point** the live quote back to that revision, **keep the same
  number**, **stay APPROVED** (rev was approved before), and **keep the other revisions**. Flow:
  **Sales requests → Engineer/Admin approves**, recording approver **name / position / date-time**.
- **How it works:** `approveRevisionRestore` snapshots the current (superseded) version first (so
  nothing is lost), drops the target from history (it becomes live), rebuilds the live line items
  from the target snapshot, sets `revision = targetRev`, keeps status, and appends an approval log
  entry. So restoring rev 1 leaves history = rev 0/2/3, current = rev 1. Next **Revise** numbers as
  **max-ever + 1** (so re-pointing never collides). `requestRevisionRestore` /
  `cancelRevisionRestore` manage the pending request.
- **Snapshot enrichment:** `reviseQuotation` now stores each revision's **full per-line content**
  (`fullLines`, incl. specsSnapshot) + vatMode/discountPct, so restores are exact **going forward**.
  Revisions snapshotted before this change have summary only → restore rebuilds descriptions / qty /
  prices but not detailed specs; the UI **warns** ("saved before full specs were stored").
- **Files:** `quotations/actions.ts` (helper `buildRevSnapshot`, `REVISION_SELECT`, 3 new actions,
  max+1 numbering); `quotations/[id]/revision-restore.tsx` (new UI: request select + approve/cancel
  banner + approvals audit log); wired into `quotation-builder.tsx` (revision-history card) and
  `quotations/[id]/page.tsx` (pass pending request + log). Restore controls hidden once the order is
  in production. `QuotationItem` has no inbound FKs, so delete/recreate is safe. Typecheck + lint
  clean. **No P&L math changed** (totals restored from each revision's own snapshot).

## 2026-08-08 · Fulfilment selector — show to every role (grayed-out for non-setters)
- **Owner-requested:** the Phase 2 fulfilment control (Delivery / Office pick up / Plant pick up)
  was hidden from roles that can't change it (and, on a default delivery order, hidden entirely) —
  a non-setter saw nothing. Show the button row to **every** role: interactive for those who may
  change it, **grayed-out (disabled, read-only)** for everyone else, consistently across all order
  workflows (produced / from-stock / bought-in).
- **Fix (display/gating only — no P&L, no auth change):**
  - `page.tsx`: dropped the `(canSetMode || mode !== "delivery")` gate so the fulfilment control
    always renders in the Phase 2 card.
  - `fulfillment-mode-selector.tsx`: removed the read-only text-tag branch; the button row now
    renders for all, with each button `disabled` when the viewer can't set it (or the mode isn't
    available for the order). The current mode stays highlighted (dimmed primary when read-only),
    others grayed; a "View only" hint + a tooltip name who may change it. Clicking is a no-op for
    non-setters and the server action was already gated (Sales / Engineer / Payment Approver /
    admin). One component ⇒ consistent across every workflow & role. Typecheck + lint clean.

## 2026-08-08 · Bought-in "Prepare & process the PO" — drop Technical Head from approvers
- **Owner-requested:** the Phase 4 "Prepare & process the Purchase Order" step (bought-in `released`
  stage) listed **Purchaser + Technical Head** as approvers, but `savePurchaseOrder` is **Purchaser /
  admin only** — the Technical Head has no action there. Remove it.
- **Fix:** `pendingStep` bought-in `released` branch now returns `roles: ["purchaser"]` (was
  `["purchaser", "technical_head"]`) in `src/lib/order-workflow.ts`. This drives the order-page
  APPROVERS line, the alarms and the dashboard "waiting for", so all now show only the Purchaser —
  matching who can actually act. **No P&L / authorization change** (the server gate was already
  Purchaser/admin). Typecheck + lint clean.

## 2026-08-08 · PO price matcher — format-tolerant (word order / separators / model code)
- **Owner-requested (chose option 3):** a PO line "KDK Ceiling Cassette · 32CHH" didn't match a
  catalogue product named "CEILING CASSETTE - KDK - 32CHH", so the Avesco price didn't auto-fill.
  Make the matcher tolerant of word order / separators, keyed on the model code, without renaming.
- **Fix:** rewrote `matchKey` in `src/lib/po-catalog.ts` (used by `catalogPriceFor`,
  `catalogReferencePriceFor`, `suppliersForDescription`). Now: exact canon match → **model-code
  match** (word-order/separator tolerant, and a code match always outranks a generic/substring
  match so the specific variant wins) → generic/substring fallback. **Cross-model guard:** every
  model/part-code token of a product name must appear in the line, so "…32CHH" never matches a line
  for "…24CDH", and the line may still carry extra tokens (qty / "@price" / order-ref suffix).
  Validated with 14 cases (KDK 32CHH/24CDH/25NFB hit their own price; 32XYZ→none; suffix tolerated;
  "24" vs "24CDH" never cross; specific beats generic; legacy substring like "GI BOLT" preserved).
- **Note:** the PO price still comes from the **Products** catalogue (not inventory stock items),
  so the KDK item must exist as a Product with an Avesco price — but its Product name can now be in
  the inventory format and still match. **No P&L touched.** Typecheck + lint clean.

## 2026-08-08 · Purchasing tab — "Completed" section for finished department POs
- **Owner-reported:** a completed department PO (e.g. PO-AFBM20260000531, Fans & Blower · TKL STEEL
  CORP) showed in the Expenses records but not in the Purchasing tab. Cause: the Expenses report
  lists any non-cancelled PO with cash released, but the Purchasing tab pulls department requests
  with `status: { notIn: ["COMPLETED"] }` — so a fully-received (COMPLETED) standalone department
  requisition dropped off (it only stayed if it had an unresolved supplier return).
- **Fix (owner-approved; Phase 4):** added a collapsed **"Completed department POs"** section at the
  bottom of the Purchasing tab. `purchasing/page.tsx` now also builds `completedDeptRows` = completed
  standalone department requisitions (kind=department, no quotationId) **without** an open return
  (those with an open return stay in the active list, as before). `purchasing-workspace.tsx` renders
  them in a `<details>` block via the existing `PurchasingChain` (view / print / reconcile only — a
  COMPLETED chain has no forward steps), searchable, independent of the top tab filter. Order-linked
  bought-in POs already appear under their order group, so they're unaffected. **No P&L / workflow
  logic changed.** Typecheck + lint clean.

## 2026-08-08 · Bought-to-Supplier workflow — verified vs owner spec + message consistency
- **Owner-requested:** update the Bought-to-Supplier (bought-in) workflow (Delivery + Office Pick
  Up) for consistency across all roles' notifications / alarms / messages. **No P&L touched.**
- **Audit result:** the implemented flow already matches the owner's 40-step spec end-to-end —
  Phase 4 cash-voucher chain (steps 9–19: Approve Purchase → Voucher & Check Prepared → Signed →
  Cash Released → Give to Purchaser → Confirm → Give to Logistics & Distribute → Logistics Confirm
  → Item Bought → Check & Approve), Phase 5 (final payment → **Transferred to Office** → Sales
  **Quality & Quantity Checked** → **Save Documents & Approve Delivery** → Mark Delivered / **Approve
  POD - Successful Pick Up** for office pickup which is one combined Sales step via
  `approvePickupDelivery` → surrender → confirm → **File Documents-Close Order**), and Phase 6
  commission (Approve Amount → Prepare Voucher → Approve Voucher → Release Budget → Mark Received →
  Upload Signed Voucher). `confirmFinalPayment` lands bought-in at `qa_plant_checked`, so both
  delivery & office pickup run transfer → Sales QC → prepare docs. Sequence, roles & button labels
  all align; **no functional change needed.**
- **Fixed (label consistency only):** the "notify client" button read **"Notify client – order
  ready"** on the bought-in Phase 2 panel but **"Notify Client - Order Ready"** on the produced
  path → aligned both (`bought-in-production.tsx`). The delivery POD button read **"Approve
  POD-Successful Delivery"** (no spaces) while its own waiting-for banner and the pick-up variant use
  the spaced form → aligned to **"Approve POD - Successful Delivery"** (`fulfillment-actions.tsx`).
  Typecheck + lint clean.

## 2026-08-08 · PO form — auto-fill Avesco when a KDK product is on the line
- **Owner-requested:** KDK products (e.g. KDK Ceiling Cassette) are always sourced from **Avesco**,
  so a new Purchase Order that carries a KDK item should auto-fill the supplier with Avesco's details
  from the Suppliers list — mirroring the existing Wind Driven Roof Ventilator → JOEL LATERO SHOP
  rule.
- **Fix:** `purchase-order-panel.tsx` — added a `KDK_SUPPLIER = "AVESCO"` / `isKdkLine` (`/\bkdk\b/i`)
  brand rule to the new-PO auto-populate effect. When a line is a KDK product and no supplier is set
  yet, it finds the saved Avesco record (name contains "avesco") and `pickSupplier`s it, so company,
  Attention (contact), Address, EWT flag & remarks fill in — and the unit price fills from Avesco's
  catalogue price if set up. Falls back to just the name if Avesco isn't in the Suppliers list. Runs
  before the single-carrier fallback, so KDK always resolves to Avesco. Consistent with the WDRV
  precedent (which likewise lives only in the per-order PO panel, not the combined-PO form).
  **No P&L / purchasing workflow change.** Typecheck + lint clean.

## 2026-08-08 · Admin override — roll-back labels match the order's actual workflow
- **Owner-requested:** the "Admin override" roll-back panel read with the generic produced-delivery
  wording regardless of the order's fulfilment mode / sourcing (e.g. a plant pick up showed
  "Transferred to office" / "Sales 2nd QC & quantity passed" / "Delivered"; a from-stock order
  showed "Payment cleared & JO created" though it has no job order).
- **Fix (display-only — labels & which stages are offered; rollback actions unchanged, they key off
  stage/approval keys not labels):** the roll-back **approval list** and **stage dropdown** now use
  mode-aware labels driven by `stockOnly` / `boughtInOnly` / `plantPick` / `officePickup`:
  - `payment_cleared` → "Payment cleared" (from-stock / bought-in, no JO) vs "Payment cleared & JO created".
  - `client_notified` → "Released from stock & client notified" (from-stock).
  - `qa_transferred` → "Delivery form made" (plant pick up) vs "Transferred to office".
  - `qa_sales_checked` → "Delivery approved" (plant) / "Quality & quantity checked" (bought-in) vs "Sales 2nd QC & quantity passed".
  - `delivered` / `delivery_confirmed` → "Picked up" / "Pick up confirmed" for pick-up modes.
  - `released` stage → "For stock release" / "For purchasing" / "For JO creation".
  - Non-produced orders (from-stock / bought-in) no longer offer the production stages
    (`in_production` / `jo_received` / `producing` / `production_finished`) as roll-back targets.
  - `orders/[id]/page.tsx` only. Typecheck + lint clean. **No P&L touched.**

## 2026-08-08 · Documents — full two-way mirror between quotation & order tabs
- **Owner-requested:** whatever document is on the quotations tab must reflect on the orders-tab
  workflow and vice versa. Storage was already shared (`sale.docs` in the quote JSON), but the
  **display** was one-directional: several order-workflow documents never surfaced back on the
  quotation tab (and two didn't show in the order's own read-only Documents list).
- **Fix (display-only — no workflow/gate/role/P&L change):**
  - `sale-document-list.tsx` (order read-only): now also lists **Billing statement**
    (`billing_statement`) and the plant pick up **Delivery form** (`delivery_form`).
  - Quotation `page.tsx`: renders the same `SaleDocumentList` so **every** order document (PO,
    closing docs, unsigned delivery docs, plant delivery form, billing statement, final payment,
    proof of delivery) is visible/downloadable on the quotation tab too.
  - `batch-document-list.tsx` (quotation per-batch mirror): now also shows each batch's **Proof of
    delivery** (`b.pod`) and plant **Delivery form**.
  - Client-restricted (shop-floor) users are already blocked from the quotation page, so no viewer
    gains new document access. Typecheck + lint clean.

## 2026-08-08 · Fulfilment-mode selector — broaden who can change it
- **Owner-requested:** the Phase 2 fulfilment selector (Delivery / Office pick up / Plant pick up)
  should be pressable by **Sales, Admin, Payment Approver or Engineer** — previously only the admin
  or the order's own preparer (salesperson) could change it.
- **Fix:** `canSetMode` (order page) is now `adminViewer || ((isSalesViewer || payment_approver) &&
  pickupWindowOpen)` — i.e. Sales/Engineer/Payment Approver within the Phase 2 window, admin any
  time. The `setFulfillmentMode` server action gate matches: `isAdmin || isSalesActor ||
  canEnableBatchDelivery` (= Sales / Engineer / Payment Approver / admin). Same role set already
  used by the multiple-batch toggle, so the two are consistent. The Phase-2-window guard for
  non-admins is unchanged. **No P&L touched.** Typecheck + lint clean.

## 2026-08-08 · From-stock DELIVERY release → 3-step (Warehouse → Plant Manager → Sales)
- **Owner-requested:** revise the from-stock **Delivery** release choreography. It was a 2-step
  flow (Plant Manager "Release from Stock" → Sales "Release from Stock & Notify Client", PR #259).
  New spec: **(9)** the **Warehouse** presses **"Release From Stock"** → **(10)** the **Plant
  Manager** approves and presses **"Quality & Quantity Approved"** → **(11)** **Sales** informs the
  client and presses **"Release from Stock & Notify Client"**. Delivery's release now mirrors plant
  pick up's (Warehouse releases → Plant Manager approves) plus a Sales-notify tail before Phase 5.
- **Changes:** `pendingStep` delivery/stockOnly branch now steps Warehouse `stock_released` →
  Plant Manager `stock_release_approved` → Sales `client_notified` (`order-workflow.ts`).
  `releaseOrderFromStock` releaser for delivery = Warehouse (was Plant Manager); `confirmStockRelease`
  is now the Plant Manager approval for both delivery & plant pick up (plant advances to Phase 5,
  delivery stamps `stock_release_approved` and waits); new `notifyStockReleaseClient` = the Sales
  client-notify that advances a delivery order to Phase 5 (`orders/actions.ts`). `stock-release.tsx`
  renders the 3rd stage for delivery; `page.tsx` perms: `canReleaseStock` = Warehouse (non-office),
  `canConfirmRelease` = Plant Manager, new `canNotifyRelease` = Sales. Office pick up (1-step) and
  plant pick up (2-step) unchanged. **No P&L touched.** Typecheck + lint clean.

## 2026-08-08 · From-stock release picker — show the full variant + auto-match from the quotation
- **Owner-requested:** in the stock-release matcher, an Office-supplied line (e.g. "AlphaAir Duct
  Canvass Connector · Silicone · Per meter") showed only "AlphaAir Duct Canvass Connector" — the
  **material (Silicone) was dropped**, and the line wasn't auto-matched to a stock item.
- **Fix:** `orderStockLines` (Office-supplied branch) now names the line from the salesperson's full
  **descriptionSnapshot** (flattened, brand-prefixed when missing) instead of `productLabel`
  (brand+type+model). So the release line shows the full variant, mirroring the quotation, and the
  fuller name lets the picker's auto-matcher (`autoMatchId`, substring/token match) select the
  correct stock item automatically. **No P&L math changed** — `orderStockLines` only feeds the
  release-picker display/matching (`isStockOnlyOrder` only checks its count). `department-pnl.ts`.
  Typecheck + lint clean.

## 2026-08-08 · Fix: server error uploading the final-payment proof (perms mismatch)
- **Bug:** uploading the Final payment proof (or Billing statement / closing docs) failed with the
  masked production error "An error occurred in the Server Components render…". Cause: the order
  card shows the upload affordance to any **sales viewer** (`canEditCloseDocs = canFile ||
  isSalesViewer`, which includes the SALES/ENGINEER roles), but the server gate `loadForCloseDoc`
  only allowed **admin / preparer / accounting** for those keys — so a Sales/Engineer who isn't the
  order's preparer saw the button and got a (production-masked) server rejection.
- **Fix:** `loadForCloseDoc` now also allows the sales side (`user.role === "SALES" || "ENGINEER"`)
  to attach any close-doc key **except** the Warehouseman's `delivery_form` — matching the UI's
  upload affordance. `orders/actions.ts`. Typecheck + lint clean.

## 2026-08-08 · Workflow consistency sweep — messages / banners / designations / trail
- **Owner-requested:** make every message, notification and alarm consistent across the whole
  sourcing × fulfilment matrix. Audited via 3 parallel review agents (single-batch text,
  multi-batch tables, notifications/designations/stale wording).
- **Real content fix:** the Plant-Manager quality-check step told **plant-pickup** orders their
  goods "are transferred to the office" — corrected to "released for pick up at the plant"
  (`fulfillment-actions.tsx`).
- **Designations + audit trail now mode-aware** (`orders/[id]/page.tsx`): `APPROVAL_DESIGNATION`
  and the `fTrail` labels reused the same stage keys with the wrong role for plant/office pickup.
  Now: office-pickup `qa_tested` → 2nd Quality Inspector; plant-pickup `qa_transferred` →
  Warehouse ("Delivery form made"), `qa_sales_checked` → Plant Manager ("Delivery approved"),
  `delivered` → Warehouse; from-stock plant-pickup `client_notified` → Plant Manager; pickup
  `delivered`/`delivery_confirmed` trail rows say "Picked up" / "Pick up confirmed".
- **Banner ↔ button alignment** (`order-workflow.ts`): the qaPlantCheck "waiting for" banner is
  now "Quality & Quantity Approved" on both paths (matches the button); the stock-release and
  `delivered` banners match the button casing/wording; from-stock quality-test wording
  consistently says "quality & quantity".
- **Multi-batch table casing** (`delivery-multibatch.ts`): step labels Title-cased to match the
  single-batch buttons (Transferred to Office, Quality & Quantity Approved/Re-Checked/Checked);
  bought-in office-pickup delivered label aligned to "Approve POD — successful pick up".
- **Stale comments/docstrings** refreshed (office pickup = from-stock **or bought-in**;
  `engineerApprovesStock` marked vestigial; stock-release button casing standardised).
- P&L untouched. Typecheck + lint clean. (Low-value cosmetic items — a couple of `done`-string
  and coarse orders-list stage labels — left as-is.)

## 2026-08-08 · Bought-in (Bought to Supplier) workflows — Delivery + Office pick up
- **Owner-requested (frozen Phase 5, owner-approved):** the bought-in Phase 5 is shorter than
  produced/from-stock — a bought-in order has **no plant quality steps**. After Final Payment
  Confirmed it goes straight to **Transferred to Office (Logistics) → Quality & Quantity Checked
  (Sales) → Save Documents & Approve Delivery → …**. Also **enables Office pick up** for bought-in
  orders (previously from-stock only).
- **Skip mechanism:** `confirmFinalPayment` lands a **bought-in** order on `qa_plant_checked`
  (instead of `final_pay_cleared`), skipping the quality-test + plant-QC stages; the normal
  `qa_plant_checked → Transfer → qa_transferred → Sales QC` path then runs. Works for both bought-in
  **delivery** and **office pick up** (office pickup's `qa_tested` shortcut is naturally bypassed).
- **Labels:** the Sales QC button/step reads **"Quality & Quantity Checked"** (not "Re-Checked")
  for bought-in; `pendingStep` `qa_transferred` action + the fulfilment trail label are bought-in
  aware; the `qa_plant_checked` stage label shows **"For transfer to office"** for bought-in
  (it's a transient pre-transfer landing). Step-7 button kept "Documents Checked" (owner: leave as is).
- **Office pick up for bought-in:** `availableModes` adds `office_pickup` for `boughtInOnly`;
  `setFulfillmentMode` / `setOfficePickup` guards widened. Phase 2 stays the bought-in PO flow
  (BoughtInProduction); Phase 5 uses the office-pickup tail (Sales uploads proof of pick up / surrenders).
- **Multi-batch:** new `MULTIBATCH_BOUGHTIN_STEPS` (delivery — drops qa_tested/qa_plant_checked) and
  `MULTIBATCH_BOUGHTIN_PICKUP_STEPS` (office pickup). `mbSteps`/`mbStepDef`/`mbProgress` take a
  `boughtInOnly` flag, threaded through `advanceMultiBatch`, the order page batch views and the My
  Dashboard multi-batch feed.
- **Where:** `order-workflow.ts`, `delivery-multibatch.ts`, `my-dashboard.ts`, `orders/actions.ts`,
  `orders/[id]/page.tsx`, `orders/[id]/fulfillment-actions.tsx`, `orders/page.tsx`. **P&L untouched.**
  Typecheck + lint clean.

## 2026-08-08 · From-stock Phase-2 release — role/order by fulfilment mode + billing upload
- **Owner-requested (frozen Phase 2, owner-approved):** the from-stock stock-release
  choreography now differs by fulfilment mode (the plant and office are far apart, so who
  releases differs). Replaces the old single "PM approves → Warehouse releases → auto-notify".
  - **Delivery:** Plant Manager **Release from Stock** → Sales **Release from Stock & Notify Client**.
  - **Office pick up:** Sales **Release from stock & notify client** (one step — was the Engineer).
  - **Plant pick up:** Warehouse **Release From Stock** → Plant Manager **Quality & Quantity Approved**.
- **New `stock_released` stamp** marks the physical release (inventory deducted). Two actions:
  `releaseOrderFromStock` (step 1 — matches lines + deducts; role by mode; office pickup also
  stamps `client_notified` and advances) and new `confirmStockRelease` (step 2 — delivery: Sales
  → `client_notified`; plant: PM → `stock_release_approved` + `client_notified`; both → Phase 5).
  Replaces `approveStockRelease`. `pendingStep` released/stockOnly rewritten for the 3 modes'
  two-step flow; `StockRelease` UI rewritten (mode-driven labels/roles/awaiting text); order-page
  perms `canReleaseStock` (step 1) + `canConfirmRelease` (step 2) by mode.
- **Billing statement (optional):** new `BillingStatement` upload link (clone of the final-payment
  proof), shown at the final-payment stage (`final_pay_review`/`final_pay_checked`); doc key
  `billing_statement` added to `CLOSE_DOC_KEYS`. Accounting attaches it after release, before final
  payment — same appearance/behaviour as the previous upload links.
- **Notifications/alarms/messages** all derive from `pendingStep`, so the orders-list banner, order
  "waiting for" card, approver alarm and My Dashboard feed update for every role automatically.
  **P&L untouched** per instruction. Payment-cleared button label kept as "Clear payment & release
  from stock" (owner: use that label). Typecheck + lint clean.
- **Still owner-pending:** the produced (Centrifugal/Axial) and bought-items workflows — to be
  uploaded later.

## 2026-08-08 · From-stock plant pick up — Warehouse runs the quality test
- **Owner-requested (frozen Phase 5, owner-approved):** extends the from-stock "Warehouse runs
  the quality & quantity test" rule (#257, delivery) to the **plant pick up** fulfilment mode.
  For a from-stock order (F&B on-hand, e.g. angle corner) collected at the plant, step "Quality
  Tested-Passed" is done by the **Warehouse**; the Plant Manager still approves and the
  Warehouseman still makes the delivery form. **Produced** plant-pickup orders keep Technical
  Head / QI on the quality test (unchanged — the produced workflow is still owner-pending).
- **Where:** `pendingStep` (final_pay_cleared: from-stock — delivery OR plant pickup — → Warehouse
  before the produced plant-pickup Tech-Head/QI branch); `qaTest` action (`fromStock = stockOnly
  && !pickup`, so plant pickup from-stock authorises the Warehouse); order-page `canQaTest` perm;
  new `MULTIBATCH_PLANT_STOCK_STEPS` (plant-pickup steps with `qa_tested` role = warehouse) +
  `mbSteps` returns it for plant_pickup + stockOnly. The FulfillmentActions copy/awaiting
  (via the existing `fromStock` prop) and the `qa_tested` sign-off designation already keyed off
  `stockOnly`, so they cover plant pickup automatically. Typecheck + lint clean.
- **Pending / flagged to owner:** the rest of the three from-stock specs (Delivery / Office pickup
  / Plant pickup) already match the app **except** the Phase-2 stock-release wording (steps 8–10),
  which differs across the specs and from the current two-step flow (Payment Cleared → Plant
  Manager "Approve stock release" → Warehouse "Release from stock" → auto-notify). Awaiting owner
  confirmation before touching frozen Phase 2. **P&L untouched** per instruction.

## 2026-08-08 · From-stock (F&B on-hand) delivery — Warehouse runs the quality test
- **Owner-requested (frozen Phase 5, owner-approved):** for an order fulfilled from Fans &
  Blowers on-hand **stock** (e.g. angle corner), the Phase 5 quality & quantity test (step 15,
  "Quality Tested-Passed") is done by the **Warehouse**; the **Plant Manager** then approves
  (step 16, "Quality & Quantity Approved") and **Logistics** transfers to the office (step 17,
  "Transferred to Office"). Applies to **single-batch and multi-batch delivery**.
- **The gap:** the code lumped from-stock with bought-in as "noProd" and routed both to the
  Office-side actors (Logistics/Sales/Payment Approver). A from-stock item is physically at the
  plant, so it now joins the produced-order path (Plant Manager QC, Logistics transfer) — but
  with the **Warehouse** doing the initial quality test instead of the Technical Head/QI. Only a
  **bought-in** order (never at the plant) keeps the Office-side QA.
- **Single-batch:** `pendingStep` now splits `boughtInOnly = boughtIn && !stockOnly`; from-stock
  → Warehouse test then Plant Manager. `qaTest` / `qaPlantCheck` actions authorise accordingly
  (new `orderSourcingFlags`, replacing `isNoProductionOrder`). Order-page `perms`
  (`canQaTest`/`canQaPlant`), the `FulfillmentActions` copy + "awaiting" roles (new `fromStock`
  prop), the `qa_tested` sign-off designation (→ Warehouse), and the `qa_plant_checked` stage
  label all updated.
- **Multi-batch:** new `MULTIBATCH_STOCK_STEPS` (delivery steps with `qa_tested` role =
  `warehouse`); `mbSteps`/`mbStepDef`/`mbProgress` take an optional `stockOnly`. Threaded through
  `advanceMultiBatch` (auth + progress), the order page's batch views, and the My Dashboard
  multi-batch feed. Produced & bought-in orders and office/plant pick up are unchanged.
- **Where:** `lib/order-workflow.ts`, `lib/delivery-multibatch.ts`, `lib/my-dashboard.ts`,
  `orders/actions.ts`, `orders/[id]/page.tsx`, `orders/[id]/fulfillment-actions.tsx`,
  `orders/page.tsx`. Typecheck + lint clean.

## 2026-08-08 · Zero-rated — Certificate of VAT Exempt/Zero Rated upload
- **Owner-requested:** a zero-rated sale also requires a **Certificate of VAT Exempt/Zero
  Rated**; add an upload slot with the same behaviour as the other closing attachments.
- **New doc key `vat_zero_cert`** (`VAT_ZERO_CERT_DOC` in `sale.ts`). It's appended (required)
  only for zero-rated. Threaded a `zeroRated` flag through the closing-doc helpers —
  `afterPaymentDocTypes`, `plantDocTypes`, `closeDocsState`, `plantCloseState` all take an
  optional `zeroRated` (default false); when set they add the certificate slot and the close
  gate requires it. NOT added to `deliveryUnsignedDocTypes` (the cert has no unsigned pre-
  delivery variant — it's a closing attachment).
- **Plumbed `zeroRated = quote.vatMode === "ZERO_RATED"`** from the order page + quotation
  page/builder down through `CloseDocuments`, `SaleDocumentList`, `FulfillmentActions`,
  `MultiBatchPanel`, `SalePanel`, `BatchDocumentList`. Server gates use it too: `fileDocuments`
  close gate and the multi-batch `delivery_docs` gate in `orders/actions.ts`. Added
  `vat_zero_cert` to `CLOSE_DOC_KEYS` + `MB_DOC_KEYS` so uploads are accepted; Accounting/Sales/
  admin attach it like the other closing docs (no special role gate).
- **Counter sales:** `counterDocSlots` adds the certificate (required) for `ZERO_RATED`;
  `addCounterSaleDoc` already validates against the slot list so the upload is accepted; detail-
  page doc caption updated.
- **Where:** `lib/sale.ts`, `lib/counter-sale.ts`, `orders/actions.ts`, `orders/[id]/`
  (`page.tsx`, `close-documents.tsx`, `fulfillment-actions.tsx`, `multi-batch-panel.tsx`,
  `sale-document-list.tsx`), `quotations/[id]/` (`page.tsx`, `quotation-builder.tsx`,
  `sale-panel.tsx`, `batch-document-list.tsx`), `counter-sales/[id]/page.tsx`. Typecheck + lint
  clean.

## 2026-08-08 · Counter-sale zero-rated + Fans head can't release stock
- **Two owner-requested changes:**
- **(1) Counter sales gains the zero-rated VAT mode** (parity with the quotation builder).
  `CounterSaleVatMode` adds `ZERO_RATED`; new `coerceCounterVatMode` + `COUNTER_VAT_LABEL`
  helpers. Totals: like EXCLUSIVE, the entered price IS the total, 0% VAT (`counterTotals`
  else branch already handled it). Docs (`counterDocSlots`): zero-rated hands over **Sales
  Invoice + Collection Receipt + Delivery Receipt + EWT (BIR 2307)** — same SI/CR/DR as
  inclusive, but the BIR 2307 (EWT) is **not optional** for zero-rated. Dropdown option added
  to the create form and the admin-edit; detail + list badges and the doc description line use
  the new label. Actions coerce all three modes. **Management P&L:** a zero-rated counter sale
  charges **no output VAT** (both `cs.vatMode !== "EXCLUSIVE"` output-VAT checks → `=== "INCLUSIVE"`).
  Files: `lib/counter-sale.ts`, `counter-sales/actions.ts`, `counter-sale-form.tsx`,
  `counter-sale-admin-edit.tsx`, `counter-sales/[id]/page.tsx`, `counter-sales/page.tsx`,
  `management/pnl-actions.ts`.
- **(2) Fans & Blowers head can no longer release from stock** (owner-approved, frozen Phase 2).
  Items manufactured by Fans & Blowers are released from stock by the **Warehouse only** (the
  Fans & Blowers head has no authority). Removed `prod_head_fans` from: the "Release from stock"
  approvers banner (`order-workflow.ts` pendingStep), the release authorization
  (`STOCK_RELEASE_ROLES` in `orders/actions.ts` + its error text), and the UI gate
  (`canReleaseStock` in `orders/[id]/page.tsx`). Updated the user-facing "Awaiting the
  Warehouse to release the stock" wording in `stock-release.tsx`. Plant-Manager/Engineer
  approval step is unchanged. Typecheck + lint clean.

## 2026-08-08 · New VAT presentation — "VAT exclusive zero rated"
- **Owner-requested:** add a 4th VAT presentation to the quotation builder, **VAT
  exclusive zero rated** — the total is the **same figure as VAT inclusive** (the entered
  price IS the total) but the sale is **zero-rated: 0% output VAT** (usually 1% EWT
  withheld). Its closing documents are **Sales Invoice, Collection Receipt, Delivery
  Receipt and EWT** (= BIR 2307).
- **Stored `vatMode = "ZERO_RATED"`** (the column is a free String, default INCLUSIVE — no
  migration). Centralised the mode semantics in `quote.ts`:
  - `vatDisplayBasisIsGross(mode)` → INCLUSIVE & ZERO_RATED show the entered (gross) price
    as the base; the exclusive modes strip VAT (÷1.12).
  - `vatModeAddsVat(mode)` → only EXCLUSIVE_PLUS adds 12% on top.
  - `vatModeChargesOutputVat(mode)` → INCLUSIVE & EXCLUSIVE_PLUS charge output VAT;
    EXCLUSIVE & ZERO_RATED do not.
  - `payableTotal` uses `vatDisplayBasisIsGross` → a zero-rated quote's deal value equals the
    entered price (matches VAT inclusive). Everything computing the deal value flows through
    `payableTotal` (WON amount, dashboards, sales report, customers, finance monitor).
- **Documents:** no Phase-5 change needed — the closing-doc derivation is `vatMode !==
  "EXCLUSIVE"`, so ZERO_RATED already gets the full VAT set (Sales Invoice, Collection
  Receipt, Delivery Receipt, BIR 2307/EWT). Exactly what zero-rated requires.
- **Presentation:** builder dropdown option + totals ("NET AMOUNT (VAT zero-rated)"); the
  quotation **PDF** and **Excel** show the gross figure with a "VAT zero-rated" net label and
  no VAT line; PDF/Excel routes + `quotations/[id]/page.tsx` pass the mode through.
- **Management P&L:** zero-rated books **no output VAT**; because it has no VAT to strip, the
  **full line price is department revenue** (new `saleLineNet` — `lineNetOf` still ÷1.12 for
  the other modes). `markupDiscountNet` / `pnl-detail` use the gross display basis for
  ZERO_RATED (but don't strip VAT from the mark-up/discount, since there is none). New
  `VAT_MODE_LABEL` entry "Zero-rated".
- **Where:** `quote.ts` (helpers + `payableTotal`); `quotation-builder.tsx`, `pdf/quotation-
  pdf.tsx`, `excel/quotation-xlsx.ts` (presentation); `pnl-actions.ts`, `pnl-detail.tsx`
  (output VAT + revenue basis); `quotations/actions.ts` (zod enum), `quotations/[id]/page.tsx`
  + the pdf/excel routes (passthrough). Typecheck + lint clean.
- **Out of scope / flagged:** counter-sales keeps its 2-option INCLUSIVE|EXCLUSIVE model —
  zero-rated wasn't added there (separate channel). Say the word to extend it.

## 2026-08-08 · Closing documents — VAT-appropriate labels everywhere
- **Owner-requested:** the closing-document upload slots should be named by the tax
  treatment (matching the counter-sales taxonomy), and consistently across every place
  they appear (order Phase 5, quotation Sale panel, delivery-docs prep, multi-batch,
  plant pick up):
  - **VAT-inclusive** → **Delivery Receipt** + **Collection Receipt** (plus Sales Invoice
    & BIR 2307).
  - **VAT-exclusive** → **Delivery Form** + **Acknowledgement Form**.
- **Centralised in `sale.ts`:** new `collectionReceiptLabel(vat)` / `deliveryDocLabel(vat)`
  and a `vatLabel()` remapper. `afterPaymentDocTypes` and `deliveryUnsignedDocTypes` now
  relabel the `or_cr_af` slot ("Collection Receipt"/"Acknowledgement Form") and the delivery
  slot (`delivery_receipt`/`unsigned_dr` → "Delivery Receipt"/"Delivery Form") by VAT.
  **Doc keys are unchanged**, so existing uploads stay valid — only the display labels move.
  Every consumer already renders `t.label` from these helpers, so the change propagates
  everywhere with no per-file edits.
- **Plant pick up reconciled:** `plantDocTypes(false)` (VAT-exclusive) now pairs the
  Warehouseman's **delivery form** with an **Acknowledgement Form** (`or_cr_af`) slot — this
  revises the earlier "delivery form alone is enough" so VAT-exclusive plant matches the
  general VAT-exclusive rule (Delivery Form + Acknowledgement Form). VAT-inclusive plant
  relabelled to Collection Receipt + Delivery Receipt. Flagged to owner.
- **Also:** `fulfillment-actions.tsx` plant "Make the delivery form" caption no longer says
  "Delivery Receipt" (VAT-inclusive-specific) — now "prepares and attaches the delivery form".
- **Where:** `sale.ts` (label helpers + `afterPaymentDocTypes`/`deliveryUnsignedDocTypes`/
  `plantDocTypes`); `fulfillment-actions.tsx` (caption). Typecheck + lint clean.

## 2026-08-07 · Plant pick up — VAT-aware documents (delivery form vs closing docs)
- **Owner-requested:** for plant pick up the **Warehouseman's delivery form** is a distinct
  document. **VAT-exclusive** → the delivery form alone is enough to close. **VAT-inclusive**
  → Accounting also makes the Sales Invoice, OR/CR/AF and Delivery Receipt.
- **New `delivery_form` doc slot** (Warehouseman) — the "Make the delivery form" step now
  attaches `delivery_form` (was reusing `delivery_receipt`). `plantDocTypes(vatInclusive)` /
  `plantCloseState(...)` in `sale.ts` encode the requirement (delivery form always; SI/OR/DR
  only for VAT-inclusive; no BIR 2307 per owner).
- **Where:** `sale.ts` (`plantDocTypes`/`plantCloseState`); `actions.ts` (`CLOSE_DOC_KEYS` +
  `MB_DOC_KEYS` gain `delivery_form`; `qaTransfer` requires the delivery form; `fileDocuments`
  + the multi-batch `delivery_docs` gate use the plant/VAT requirement; `loadForCloseDoc`
  lets the Warehouseman attach `delivery_form`); `close-documents.tsx` (plant-aware slots +
  gate — VAT-exclusive shows no accounting slots, closes on the delivery form); `plant-doc-
  step.tsx` (form kind → `delivery_form`); `fulfillment-actions.tsx` + `multi-batch-panel.tsx`
  (plant/VAT doc slots). Typecheck + lint clean.
- **Multi-batch note:** the WH attaches the batch's delivery documents at the make-form step
  (bundled); for VAT-inclusive that includes SI/OR/DR (can split to Accounting later).

## 2026-08-07 · Plant pick up — multi-batch (PR 3 of 3)
- **Feature (owner-approved, frozen Phase 5 multi-batch):** plant pick up can be collected
  in multiple batches; each batch repeats the plant Phase-5 sequence. Reuses the multi-batch
  engine with a plant step variant, alongside delivery and office-pickup variants.
- **`MULTIBATCH_PLANT_PICKUP_STEPS`** (per batch): notify client → payment checked → payment
  confirmed → quality tested (Tech Head/QI) → Plant Manager "Quality & Quantity Approved" →
  **Warehouseman "Make the delivery form"** (`delivery_docs`) → **Plant Manager "Approve
  delivery"** (`delivery_approved`) → **Warehouseman "Upload proof of pick up & mark picked
  up"** (`delivered`) → **Sales "Approve POD"** (`delivery_confirmed`) → Accounting "Confirm
  documents received" → "File documents — batch picked up".
- **Engine generalised:** `mbSteps`/`mbStepDef`/`mbProgress` now take a `MBMode`
  (`delivery | office_pickup | plant_pickup`) instead of an `officePickup` boolean; all
  callers pass `wf.fulfillmentMode`. `advanceMultiBatch` uses the mode. The Warehouseman may
  attach the batch's delivery documents + proof of pick up (`saveMultiBatchDoc` /
  `saveMultiBatchPod` / `removeMultiBatchPod`). `setMultiBatchPickup` now works for any
  pick-up mode. The "Multi-batch pick up" toggle + multi-mode card + `MultiBatchPanel`
  relabelling now cover plant pickup (`isPickupMode = office || plant`).
- **Known simplification:** in multi-batch the "Make the delivery form" step bundles the
  batch's delivery documents (SI/OR/DR), whereas single-batch splits DR-at-make-form from
  SI/OR-at-close. Functional; can refine if the owner wants the split per batch.
- Typecheck + lint clean.

## 2026-08-07 · Plant pick up — single-batch Phase 5 + 3-way selector (PR 2 of 3)
- **Feature (owner-approved, frozen Phase 2/5):** adds the **plant pick up** handover mode
  (client collects at the plant). Per `docs/plant-pickup-design.md` + owner confirmations:
  delivery form = the Delivery Receipt (Warehouseman attaches it), Make-form and
  Approve-delivery are two steps, and from-stock plant pickup uses the same QA roles as
  produced.
- **3-way selector** replaces the old office-pickup on/off toggle on the Phase 2 card:
  **Delivery · Office pick up · Plant pick up** (`FulfillmentModeSelector` +
  `setFulfillmentMode`). Options gated by contents: office pick up = from-stock; plant pick
  up = not bought-in-only. Admin can change any time; a non-admin only before the order
  leaves Phase 2.
- **Plant pick up Phase 5 (single-batch)** — mapped onto existing stages with plant labels/
  roles: QA test (Tech Head/QI) `qa_tested` → Plant Manager "Quality & Quantity Approved"
  `qa_plant_checked` → **Warehouseman "Make the delivery form"** (attach DR) `qa_transferred`
  → **Plant Manager "Approve Delivery"** `qa_sales_checked` → **Warehouseman "Upload form +
  proof of pick up"** `delivered` → **Sales "Approve POD – Successful Pick Up"**
  `delivery_confirmed` → **Accounting "Confirm Documents Received"** (skips surrender)
  `docs_received` → File. All gated on `fulfillmentMode === "plant_pickup"`.
- **Where:** `order-workflow.ts` (`pendingStep` plant branches + `plantPickup` arg; 4 callers
  updated), `actions.ts` (`qaTest`/`qaPlantCheck`/`qaTransfer`/`qaSalesCheck`/`markDelivered`/
  `confirmDocsReceived` plant branches; `loadForCloseDoc` allows Warehouseman for DR/POD; new
  `setFulfillmentMode`), `page.tsx` (plant-aware perms; the selector; header badge shows the
  mode), `fulfillment-actions.tsx` (plant Phase-5 UI), new `plant-doc-step.tsx` +
  `fulfillment-mode-selector.tsx`. The old `office-pickup-toggle.tsx` is now unused.
- **Notes:** typecheck + lint clean; the build compiles (the only failure is prerendering an
  unrelated Supabase-env page). Plant **multi-batch** is PR 3. Single-batch plant pickup on a
  from-stock order still uses the normal two-step stock release in Phase 2 (fine).

## 2026-08-07 · Fulfilment mode — enum refactor (plant pickup PR 1 of 3)
- **Refactor (no behaviour change), per `docs/plant-pickup-design.md`:** introduced
  `wf.fulfillmentMode: "delivery" | "office_pickup" | "plant_pickup"` as the source of
  truth for the handover mode, in preparation for adding **plant pick up**.
  - `src/lib/order-workflow.ts` — new `FulfillmentMode` type + `fulfillmentMode` field on
    `OrderWorkflow`; coerce reads the stored enum, falling back to the legacy `officePickup`
    boolean (so pre-enum orders keep working). `officePickup` is now **derived**
    (`=== "office_pickup"`) so all existing office-pickup call sites read unchanged.
  - `src/app/(app)/orders/actions.ts` — `setOfficePickup` now writes `fulfillmentMode`
    instead of the boolean.
- **Zero behaviour change** — legacy data coerces identically; the ~30 `wf.officePickup`
  reads still work via the derived field. Sets up PR 2 (plant single-batch + 3-way selector)
  and PR 3 (plant multi-batch).

## 2026-08-07 · Office pickup — toggle label reads "On - Office pick up / Off - Delivery"
- **Owner-requested:** the Phase 2 `OfficePickupToggle` label now reads
  **"On - Office pick up / Off - Delivery"** (was "Office pick up"/"Office pick up?"), so
  both toggle positions are self-explanatory. The header badge and the read-only tag keep
  saying "Office pick up" — they're status indicators shown only when pickup is on, where
  an on/off legend would be meaningless.
- **Also removed** the now-redundant caption "Client collects at the office instead of
  delivery." from the Phase 2 toggle box (the toggle label already says it).
- **Where:** `src/app/(app)/orders/[id]/office-pickup-toggle.tsx`,
  `src/app/(app)/orders/[id]/page.tsx`.

## 2026-08-07 · Office pickup — multi-batch pick up (client collects in batches)
- **Feature (owner-requested, frozen Phase 5 multi-batch):** an office-pickup order can be
  picked up in **multiple batches**; each batch repeats the pickup Phase-5 sequence (the
  owner's steps 12–19). Reuses the existing multi-batch **delivery** engine with a pickup
  step variant — the normal multi-batch delivery flow is unchanged (all gated on
  `wf.officePickup`).
- **Per-batch pickup sequence** (`MULTIBATCH_PICKUP_STEPS`): notify client (batch ready
  for pick up) → payment checked (collects partial payment) → payment confirmed → quality
  tested (**2nd Quality Inspector**) → save documents & approve pick up (Accounting) →
  **Approve POD — successful pick up** (**Sales**; uploads the proof of pick up + approves
  in one combined step, matching the single-pickup flow) → documents surrendered
  (**Sales**) → confirm documents received (Accounting) → file documents — batch picked up
  (Accounting). **Skips** the delivery-only plant-QC → transfer → Sales-2nd-QC. Shares step
  KEYS with the delivery list; the combined POD+approve step reuses the `delivered` key so
  the POD gate, delivered-qty tracking and close trigger work unchanged.
- **Toggle** (`MultiBatchPickupToggle` + `setMultiBatchPickup`): a single "Multi-batch pick
  up" toggle. **Admin** can turn it on/off any time; a **non-admin** (salesperson) can turn
  it ON but **not off** — once on, only an admin can turn it off (enforced server-side).
  Turning on sets `batchDeliveryEnabled` + `deliveryMode: "multi"`.
- **Where:**
  - `src/lib/delivery-multibatch.ts` — `MULTIBATCH_PICKUP_STEPS`; `mbSteps(officePickup)`;
    `mbStepDef`/`mbProgress` gained an `officePickup` arg.
  - `src/app/(app)/orders/actions.ts` — `advanceMultiBatch` passes `wf.officePickup`;
    `saveMultiBatchPod`/`removeMultiBatchPod` allow **Sales** for pickup; new
    `setMultiBatchPickup`.
  - `src/lib/my-dashboard.ts` — batch `mbProgress` passes `wf.officePickup`.
  - `src/app/(app)/orders/[id]/page.tsx` — batch step-views use `mbSteps(officePickup)`;
    the pickup toggle card + pickup-aware multi-mode card; `MultiBatchPanel` gets
    `officePickup`.
  - `src/app/(app)/orders/[id]/multi-batch-panel.tsx` — `officePickup` prop relabels
    "delivery" → "pick up".
  - `src/app/(app)/orders/[id]/multi-batch-pickup-toggle.tsx` — NEW.
- **Combined per-batch POD step (owner-requested):** the proof-of-pick-up upload and the
  POD approval are now **one** Sales step per batch (the `delivered` step relabeled
  "Approve POD — successful pick up"; the separate `delivery_confirmed` step was dropped
  from the pickup list) — matching the single-pickup flow. No other engine change needed.

## 2026-08-07 · Inquiries list — show the WON amount
- **Owner-requested:** the Inquiries list now shows the **won amount** under the status
  badge for any inquiry with a confirmed (won) quotation. Amount = sum of
  `payableTotal(q)` over the inquiry's confirmed quotations — the **same basis as the WON
  sales report** (`isSaleConfirmed(saleFromClassification(...))`), so the two reconcile.
- **Where:** `src/app/(app)/inquiries/page.tsx` (query now selects each quotation's
  `total/discountPct/vatMode/currency/classification`; computes `wonAmount` + `currency`
  per row) and `src/app/(app)/inquiries/inquiries-table.tsx` (renders the amount in
  emerald under the badge when `wonAmount > 0`).

## 2026-08-07 · Office pickup — "Pick Up" button wording in Phase 5
- **Owner-requested label change (pickup only):**
  - "Save Documents & Approve Delivery" → **"Save Documents & Approve Pick Up"**
    (`DeliveryDocsForm` gained an `officePickup` prop; passed through from
    `fulfillment-actions.tsx`; the normal delivery flow keeps "…Approve Delivery").
  - "Approve POD - Successful Delivery" → **"Approve POD - Successful Pick Up"**
    (`PickupPodForm` is pickup-only, changed directly — button + enable hint).

## 2026-08-07 · Office pickup — one-step "Release from Stock and Notify Client"
- **Feature (owner-requested, frozen Phase 2 stock-release):** when the **Office pick up**
  flag is on, the from-stock Phase-2 panel collapses the normal two steps (Plant
  Manager/Engineer **approve** → Warehouse **release**) into a **single** action:
  **"Release from Stock and Notify Client"**, pressed by the Plant Manager / Engineer
  (in-house duct hardware only) / admin. It picks the stock item(s), deducts inventory,
  and advances straight to final payment (client notified) — then Accounting issues the
  billing statement (skippable) and the client makes the final payment as before.
- **Gated on `officePickup`** — the normal from-stock flow keeps its two steps unchanged.
- **Refinements (owner-requested):**
  - The pickup release is the **Engineer's** action alone — **not** the Plant Manager.
    `releaseOrderFromStock` (pickup branch) gates on Engineer / admin only; `pendingStep`
    returns `{ roles: [], engineer: true }` so the "waiting for" banner, My Dashboard,
    the orders list and the approver alarm all show **Engineer** only; the panel wording
    is "Awaiting the Engineer to release from stock and notify the client"; the
    Phase-2 approve gate (`canApprove`) drops Plant Manager for pickup.
  - **Toggle-lock policy:** an **admin** can flip Office pick up on/off at any time; a
    **non-admin** (salesperson) can set it only while the order is still in Phase 2
    (`stageIndex(wf.stage) <= "released"`), after which it locks for them (they see the
    read-only tag). `canSetPickup` = `stockOnly && (admin || (preparer && pickupWindowOpen))`.
  - **Normal (non-pickup) from-stock release is now Plant-Manager-only** — the mirror of
    the pickup rule, so the two workflows partition cleanly: **Engineer → office pickup**,
    **Plant Manager → normal from-stock**. This **supersedes #241/#243** (which had let an
    Engineer approve normal from-stock release for duct hardware). `approveStockRelease`
    now gates on Plant Manager / admin only; `pendingStep` drops the `engineer` flag from
    the normal approve step (so the banner / My Dashboard / orders list / alarm show
    **Plant Manager** only); `StockRelease` wording is "Awaiting Plant Manager approval";
    the Phase-2 `canApprove` for non-pickup drops the Engineer. (`isDuctHardwareStockOnly`
    import removed from `actions.ts`; `engineerApprovesStock` is now unused by `pendingStep`
    but still passed by callers.)
- **Where:**
  - `src/app/(app)/orders/actions.ts` — `releaseOrderFromStock` now branches on
    `wf.officePickup`: for pickup it gates on Plant Manager / Engineer(duct-hardware) /
    admin and does NOT require a prior approval stamp; it stamps both
    `stock_release_approved` and `client_notified`. Normal flow still needs the Warehouse
    role + prior approval.
  - `src/lib/order-workflow.ts` — `pendingStep` "released" case returns a single
    "Release from stock & notify client" step for pickup orders.
  - `src/app/(app)/orders/[id]/stock-release.tsx` — `officePickup` prop; single combined
    button that opens the stock picker; shared `release()` helper.
  - `src/app/(app)/orders/[id]/page.tsx` — passes `officePickup` to `StockRelease`.

## 2026-08-07 · Office pickup workflow — STEP 2 built (from-stock, pickup Phase 5)
- **Feature (owner-approved, frozen Phases 1/2/5):** when the **Office pick up** flag is
  on, the order follows a from-stock pickup path. Confirmed with the owner: office pickup
  is **from-stock only** (reuses the existing release-from-stock spine, which already
  skips Phase 2 production and jumps to final payment), and only the **Phase-5 tail**
  differs. The normal (non-pickup) flow is **not modified** — every change gates on
  `wf.officePickup`.
- **Pickup Phase-5 divergences (vs the normal from-stock flow):**
  - QA test performed by the **2nd Quality Inspector** (`quality_inspector_2`) — added to
    the `qaTest` gate + `canQaTest` perm + UI wording when pickup.
  - **Skips** plant-QC → transfer → Sales-2nd-QC: `prepareDeliveryDocs` accepts stage
    `qa_tested` when pickup (→ `delivery_docs_ready`), and the UI shows the delivery-docs
    form straight after the quality test.
  - **Sales** uploads the proof of pick up AND approves in one step — new action
    `approvePickupDelivery` (delivery_docs_ready → delivery_confirmed, requires the pod
    file) + new `PickupPodForm` component (mirrors `DeliveredForm`, Sales-facing).
  - **Sales** surrenders the signed docs (not Logistics): `surrenderDeliveryDocs` gates
    on Sales when pickup.
  - `loadForCloseDoc` now also lets **Sales** attach the `pod` slot (proof of pick up).
  - Confirm-received → file → commission are reused unchanged.
- **Where:**
  - `src/app/(app)/orders/actions.ts` — `setOfficePickup` now rejects non-from-stock
    orders; `qaTest`, `prepareDeliveryDocs`, `surrenderDeliveryDocs`, `loadForCloseDoc`
    gained `officePickup` branches; new `approvePickupDelivery`.
  - `src/lib/order-workflow.ts` — `pendingStep` gained an `officePickup` arg and pickup
    branches for `final_pay_cleared` / `qa_tested` / `delivery_docs_ready` /
    `delivery_confirmed`. All 4 callers (`pending-approvals.ts`, `my-dashboard.ts`,
    orders list `page.tsx`, order `page.tsx`) pass `wf.officePickup`.
  - `src/app/(app)/orders/[id]/page.tsx` — `canSetPickup` now also requires `stockOnly`;
    `canQaTest` includes `quality_inspector_2` for pickup; passes `officePickup` to
    `FulfillmentActions`.
  - `src/app/(app)/orders/[id]/fulfillment-actions.tsx` — `officePickup` prop; pickup
    branches for the QA-test / qa_tested / delivery_docs_ready / delivery_confirmed steps.
  - `src/app/(app)/orders/[id]/pickup-pod-form.tsx` — NEW.
- **Progress bar tidied:** the top stage-progress chips now hide the skipped stages
  (`qa_plant_checked` / `qa_transferred` / `qa_sales_checked` / `delivered`) for a pickup
  order (filtered `ORDER_STAGES` when `officePickup`; done/current computed against the
  filtered list). Normal flow shows all chips as before.
- **Scope note:** office pickup is a **single** fulfilment pass (the correct spec has no
  multi-batch; the multi-batch mention belonged to the discarded plant-pickup paste).

## 2026-08-07 · "Office pick up" flag on Phase 2 (step 1 of 2 — flag + tag only)
- **Feature (owner-requested):** an **Office pick up** toggle on the Phase 2 card marks
  an order as collected by the client at the office instead of delivered. **Step 1
  only** (per owner): this **persists the flag and shows a tag** — it does **NOT** yet
  change any Phase 5 delivery logic. Non-destructive / reversible.
- **Where:**
  - `src/lib/order-workflow.ts` — `OrderWorkflow` gained `officePickup?: boolean`,
    coerced from the stored `wf` blob (mirrors `batchDeliveryEnabled`).
  - `src/app/(app)/orders/actions.ts` — new `setOfficePickup(quotationId, enabled)`
    server action, gated on `canManageMultiDelivery` (order's salesperson or admin).
  - `src/app/(app)/orders/[id]/office-pickup-toggle.tsx` — new client toggle
    (mirrors `batch-delivery-toggle.tsx`, `Store` icon).
  - `src/app/(app)/orders/[id]/page.tsx` — derives `officePickup` / `canSetPickup`;
    renders an amber "Office pick up" badge in the order header and a toggle/tag box at
    the top of the Phase 2 card (toggle for Sales/admin, read-only tag for others).
- **Note on frozen areas:** the Phase 2 card is a frozen area — the owner explicitly
  approved adding this checkbox in-conversation. Only additive UI + a new flag were
  added; no existing Phase 2 job-order logic was changed.
- **STEP 2 — office-pickup Phase-5 variant: DONE** (see the next entry below).

## 2026-08-07 · Approval alarm + dashboard now deep-link to the pending phase
- **Feature (owner-requested):** Tapping the flashing "Approval needed" pop-up now
  navigates straight to the order, scrolled to the pending phase card — instead of
  just silencing. My Dashboard's pending order tasks link to the same phase anchor.
- **Behaviour (per owner):** the pop-up auto-jumps to a single order (the most recent
  of those waiting) via a "Go to order {code}" button; other waiting orders are noted
  ("+N more — see My Dashboard"). A separate "Dismiss" button (and tapping outside /
  any key) silences without navigating.
- **Where:**
  - `src/lib/order-workflow.ts` — new `phaseAnchor(stage)` → "phase-1|2|5" (order
    stages only ever sit in Phase 1/2/5).
  - `src/lib/pending-approvals.ts` — `PendingApproval` gained `anchor`; the API
    (`/api/pending-approvals`) passes it through.
  - `src/components/approver-alarm.tsx` — navigation on tap (useRouter), Escape /
    backdrop = dismiss, card tap doesn't dismiss.
  - `src/app/(app)/orders/[id]/page.tsx` — `id="phase-1|2|5"` + `scroll-mt-24` on the
    Phase 1 / 2 / 5 cards (anchor targets; frozen cards, presentational only).
  - `src/lib/my-dashboard.ts` — order task `href` now includes `#phase-N`.
- **Notes:** hash-scroll uses the app's existing pattern (e.g. `/inventory#inv-items`).
  Multi-batch Phase 5 orders fall back to the top of the order page (no separate anchor).
- **Pending:** none.

## 2026-08-07 · Engineer stock-release approval limited to duct hardware (refines #241)
- **Change (owner-approved, frozen Phase 2):** #241 let an Engineer approve ANY from-stock
  release. Per owner, restrict that: an Engineer may approve only when every from-stock line
  is in-house duct hardware — **Duct Angle corner, TDC Cleat, S-clip, C-clip**. If the order
  has any Office-supplied resale stock (AlphaAir, Vent Cap), only the Plant Manager (or admin)
  may approve. Plant Manager/admin still approve everything.
- **New helper:** `isDuctHardwareStockOnly(items)` in `src/lib/department-pnl.ts` — true when
  all from-stock lines classify as `isDuctHardware` (reuses the existing classifiers).
- **Where:** server gate `approveStockRelease` (`actions.ts`) now loads items first and gates
  the Engineer on `isDuctHardwareStockOnly` (clear error otherwise); UI `canApprove` +
  `engineerEligible` wording on the Phase 2 card (`page.tsx`, `stock-release.tsx`); and
  `pendingStep(wf, stockOnly, engineerApprovesStock)` gained a 3rd flag so the `engineer`
  approver flag (banner / dashboard / alarm) is set only for duct-hardware-only orders. All
  four `pendingStep` callers updated (`orders/[id]/page.tsx`, `orders/page.tsx`,
  `my-dashboard.ts`, `pending-approvals.ts`).
- **Pending:** none.

## 2026-08-07 · "Waiting for" for from-stock orders now routes to Warehouse, not the PO step
- **Bug:** On a from-stock order, the Phase 2 "WAITING FOR / APPROVERS" banner (and the
  order-list hint, My Dashboard tasks, and approval alarms) showed "Prepare & process the
  Purchase Order — Purchaser / Technical Head". A from-stock order has no PO; it's released
  from stock by the Warehouse. So the wrong roles were shown and alarmed.
- **Cause:** `pendingStep(wf)` in `src/lib/order-workflow.ts` only saw job-order content;
  a from-stock order has none, so it was treated as bought-in (the PO path). It couldn't
  tell stock-only from bought-in because that distinction lives in the quotation lines.
- **Fix (owner-approved, touches frozen Phase 1/2 routing — display only, no stage/gate
  change):** `pendingStep(wf, stockOnly)` gained an optional flag. For a stock-only order at
  the `released` stage it now returns: not-yet-approved → "Approve stock release" (Plant
  Manager or Engineer), approved → "Release from stock" (Warehouse / Fans & Blowers head).
  Added an `engineer` flag to `PendingStep` (mirrors `sales`). All four callers pass the
  flag and honour the engineer owner: `orders/[id]/page.tsx`, `orders/page.tsx`,
  `src/lib/my-dashboard.ts`, `src/lib/pending-approvals.ts` (the last two now include
  quotation `items` to detect stock-only).
- **Pending:** none.

## 2026-08-07 · Phase 2 stock-release: Engineer can approve too (alongside Plant Manager)
- **Change (owner-approved, frozen Phase 2):** The "For stock release" approval gate
  on a from-stock order now accepts the **Engineer** base role in addition to the
  Plant Manager (and admin). Requested explicitly by the owner.
- **Where:** server gate `approveStockRelease` in `src/app/(app)/orders/actions.ts`
  (added `user.role === "ENGINEER"`), UI gate `canApprove` in
  `src/app/(app)/orders/[id]/page.tsx`, and the wording in
  `src/app/(app)/orders/[id]/stock-release.tsx` ("Awaiting Plant Manager or Engineer
  approval…").
- **Note:** "Engineer" is a base app role (SALES/ENGINEER/ADMIN), not a workflow role —
  hence `user.role === "ENGINEER"`, not a `WorkflowRoleKey` check.
- **Pending:** none.

## 2026-08-07 · Purchasing draft-PO no longer wiped by auto-refresh — PR #239 (merged)
- **Bug:** In the Purchaser role, building a combined PO could lose everything
  typed (lines, quantities, prices, ticked requests, supplier/EWT details) the
  moment a notification arrived.
- **Cause:** The draft lived only in React state. The Purchasing page auto-refreshes
  every 8s and on window focus; when another user acted on a pending request (the
  event that fires the notification), it dropped out of the recomputed list, which
  unmounted the draft form. No server-side deletion was involved.
- **Fix:** Snapshot the selected requests into state when the build starts and drive
  the form from that snapshot; keep the builder mounted while building; keep the
  combine workspace mounted on the builder tab even when the pending list momentarily
  empties. Files: `src/app/(app)/purchasing/combined-purchasing.tsx`,
  `src/app/(app)/purchasing/purchasing-workspace.tsx` (frozen Phase 4 — changed only
  to fix the reported bug).
- **Pending:** Optional follow-up — pause the auto-refresh while a PO form is open,
  so the list can't shift under an active edit at all.

## 2026-08-07 · Purchaser can delete stock items — PR #238 (merged)
- Added a delete control for stock items in the Purchaser role.
- **Pending:** none.
