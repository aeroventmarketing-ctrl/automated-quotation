## 2026-08-29 · A flashing count on Inventory and Products when a change is waiting

- **Owner's instruction:** *"make a flashing notification at the word inventory and products when warehouse or
  purchaser initiate edit in inventory tab or products tab. Show this notification for purchaser, warehouse,
  payment approver and admin role."*
- Both queues were already visible **inside** their own page — the pending card on Products, the amber chip on an
  Inventory row — which is exactly the problem: you had to be on the page to know. The nav badge is the part that
  reaches someone who is somewhere else.

### The badge already existed

`navCounts` in the app layout has driven a blinking red count on Inbound RFQs and Inquiries for a while. This adds
two more entries to it — same component, same blink, on both the sidebar and the mobile menu — so there is no new
badge to get wrong. What is new is `lib/catalogue-approvals.ts`: the counting and the role gate.

- **Inventory** counts **every** pending stock action — Edit, Adjust, Reserve and Transfer alike. It shipped
  counting Edits only, on the reading that *"initiate edit"* meant the edit panel; the owner asked for the rest to
  be included (*"include this in flashing notification"*), and they were right — an adjustment sitting unapproved
  needs someone to look at it just as much, and a badge that ignored it made the Inventory row's amber "Pending"
  chip look like it was flashing about nothing. The badge's label says "stock change", not "edit", for the same
  reason: naming one of the four kinds would be wrong three times out of four.
- **Products** counts pending `ProductChange` rows. Every one is a Purchaser's save — a price owner's own writes
  straight through and never parks.
- A proposer keeps seeing their own change in the count. It is still waiting, and a badge that vanished for the
  person who raised it would read as "done".

### One departure from the four roles, and why

The Warehouse gets the **Inventory** badge but not the **Products** one. The Products pending card shows a
field-by-field diff **including supplier prices**, and the Warehouse is not a price viewer (`PRICE_ROLES` in
`price-visibility`), so that page already withholds the card from them. Badging a tab that will show them nothing is
a dead end; rendering the card instead would leak the very figures that list exists to withhold. They keep the
Inventory badge, where they are a party to the handshake. **Say the word if the Warehouse was meant to see product
prices** — that is a policy change, not a UI one.

- The badge's screen-reader label now follows the tab. It used to say *"3 ready to view"* for every count, which on
  Inventory would have told someone the opposite of the truth.

### Refresh cadence — worth knowing

The count is computed in the app layout, so it updates on navigation, on a page load, and within ~8s on the pages
that already run `AutoRefresh` (My Dashboard, Orders, a quotation). It does **not** tick on a page that has no
auto-refresh; putting `AutoRefresh` in the layout would make every page in the app re-fetch every 8 seconds, which
is a far bigger change than a badge and not one to make quietly.

### Verified — 5 new tests

- Every kind counts (Edit, Adjust, Reserve, Transfer); the Purchaser and the Payment Approver get both counts; the
  Warehouse gets Inventory only; Accounting and a role-less user get nothing; and both clear once decided.
- A missing table counts as **0** rather than throwing — this runs in the layout, so an error here would take every
  page down with it.
- Full suite **116 passed, 1 failed** — the pre-existing `selectFan` CEBDD failure on `main`, untouched. Typecheck,
  lint and build clean. No migration.

## 2026-08-28 · Catalogue spreadsheets belong to the price owner

- **Owner's instruction:** *"only the admin/payment approver can download or upload csv or excel file."*
- A spreadsheet is the catalogue in bulk: an upload writes every price at once, a download carries the whole price
  list out. Same authority as the price itself, so it lives beside it — `canTransferCatalogueFiles()` in
  `lib/price-authority.ts`, a separate name and message from `canSetCataloguePrice` because it is a separate
  question and one may be relaxed later without the other.

### What is now Admin / Payment Approver only

| Surface | Was |
| --- | --- |
| Products → Import from file | Purchaser / Payment Approver / admin |
| Products → Download Excel / CSV | **anyone who could open the page**, view-only roles included |
| Products → Export full product list (CSV) | any non-Sales user, by URL |
| Products → Export catalogue codes (CSV) | any non-Sales user, by URL |
| Inventory → Import from file | Purchaser / Warehouse / admin |
| Inventory → Download Excel / CSV | **anyone who could open the page**, view-only roles included |

- **Enforced on the server, not just hidden.** Both imports return the refusal (a thrown Server Action message is
  redacted in production) and both `/api/` exports answer **403**. A hidden button is not a control — the URL and
  the action can both be called without the screen.
- **The import gate REPLACES the old role guard rather than stacking on it.** `requireItemCreator` (Purchaser /
  Warehouse / admin) and `requireProductManager` (Purchaser / Payment Approver / admin) are each wrong here in a
  different direction — one lets a Purchaser upload prices, the other turns away a Payment Approver who holds no
  second role. Running both would have made the owner's rule unenforceable for a plain Payment Approver, which the
  new tests caught.
- Two now-dead price-stripping passes went with it: the imports used to drop a non-owner's price columns and say so.
  Only the owner reaches that code now, so the file's prices are written as given.

### One honest limitation

The **Download Excel / CSV** buttons build the file in the browser from rows already rendered on the page. Removing
them takes away the convenience, not the data — anyone who can still open Products or Inventory can read what is on
screen. Closing that properly means narrowing who may open the pages at all, which is a different decision and not
one to make silently. Say the word if it was meant.

### Left alone, deliberately

- The **Catalogue backup** (Admin → Catalogue) was already admin-only — stricter than asked, so untouched.
- Every other CSV/Excel in the app: quotations, job orders, purchase orders, sales and expense reports, the
  duplicates and suppliers exports. They carry order and quotation data, not the catalogue price list, and locking a
  Sales user out of their own quotation export is not what was asked. **Say the word if it was.**

### Verified — 3 new tests

- The Purchaser's upload is refused on **both** screens, with the reason, and nothing is written; the Warehouse's is
  refused too; the Payment Approver's lands **with its prices** on both.
- Full suite **111 passed, 1 failed** — the pre-existing `selectFan` CEBDD failure on `main`, untouched. Typecheck,
  lint and build clean. No migration.

## 2026-08-28 · The price owner confirms an Inventory edit and a Products save

- **Owner's instruction:** *"when propose edit button in inventory and save button in products is pressed let the
  admin/payment approver confirms/approves first before allowing to save."*

### ⚠️ Run migration `0047_price_owner_confirmation` in Supabase

Both halves need it (a third sign-off column on `StockAction`, and the new `ProductChange` table). Until it runs,
the Products queue reads as empty and a non-owner's save answers *"The product-approval table isn't set up yet."*
The migration also back-fills the price-owner slot on EDIT stock actions that were already fully approved under the
old two-party rule, so nothing in flight is stranded.

### Inventory — a third signature on "Propose edit"

- `StockAction` gains `approverByName` / `approverAt`. **EDIT only**: it carries the unit cost and selling price, so
  Warehouse + Purchaser is no longer enough. `ADJUST` / `RESERVE` / `TRANSFER` move stock, not money, and are
  untouched — the rule lives in one place, `stockActionComplete()` in `lib/stock-action.ts`.
- **This closes a live hole.** The A+B work reserved the price on `updateStockItemMeta`, but the edit panel does not
  go through it — it proposes a `StockAction`, and that path wrote the cost with two non-owner signatures. A
  Purchaser could set any unit cost by proposing an edit and having the Warehouseman approve it.
- The proposer still fills exactly **one** slot, the one their designation answers for. Filling every slot they
  could sign would let an admin (who holds all three) push a change through alone — the opposite of the control.
- The panel now says so before you click, and the pending card names *Admin / Payment Approver* among the awaiting
  parties and shows the third line. The dashboard task list routes an edit to them once the other two are in.

### Products — Save / Add / Delete are parked, not stripped

- A new `ProductChange` row holds the proposal **whole, prices included**, until an Admin / the Payment Approver
  confirms it. Their own Save still writes straight through — they are the confirmer.
- **A deliberate reversal of one detail from the A+B work.** The supplier-price inputs went read-only there; they
  are editable again. With the whole save now parked, a locked box would leave a Purchaser who
  spots a wrong price with no way to say so — and the price still only reaches the catalogue on the owner's click.
  The rule "only the owner SETS a price" is intact; what changed is that a non-owner may now **propose** one.
- The screen distinguishes *held* from *failed*: a parked save keeps its panel open with an amber line, because a
  save that quietly queues looks exactly like one that worked until someone reopens the row and finds it unchanged.
- The queue sits at the top of Products, visible to everyone who can manage products (the proposer has to see their
  save is waiting, not lost) with Approve / Reject for the owner and **Withdraw** for the proposer. Each row shows a
  field-by-field before → after and a **Price change** flag, so the owner confirms a change, not a name.
- **Scope, said plainly:** the per-product Save / Add / Delete go through the queue. The bulk tools — Delete
  selected, Remove no-supplier items, Clear all, and the CSV/Excel import — do **not**; they are list maintenance
  taken deliberately, and parking hundreds of rows one at a time would make the queue useless. The import still
  drops a non-owner's prices outright, as before.

### Verified — 13 new tests against a real Postgres

- **Inventory (5):** the edit is held after Warehouse + Purchaser and the item does not move; it applies on the
  owner's sign-off and only then; an early click is told who is still missing; a quantity adjustment still applies
  on the old two-party rule; and the owner's own proposal does not skip the other two.
- **Products (8):** a parked change applies **verbatim** (the proposed price included); a rejection leaves the old
  price with the reason on record; the Purchaser cannot approve their own; a change cannot be decided twice; only
  the proposer withdraws their own; a removal is parked too; an approval does not resurrect a product deleted while
  it waited; and the owner's own Add/Save park nothing.
- Two existing price-authority tests were **rewritten, not patched**: the Purchaser's product save used to half-land
  with the price silently dropped, and now waits whole. That is the behaviour change, stated rather than hidden.
- Full suite **108 passed, 1 failed** — the pre-existing `selectFan` CEBDD failure on `main`, untouched. Typecheck,
  lint and build clean. DB-backed suites need `--no-file-parallelism`: they share one database.

## 2026-08-28 · Part B — a PO price off the catalogue needs a reason

- **Owner's instruction, completing A+B:** *"purchaser, warehouse and anyone who can access purchasing tab and
  inventory tab can still access, can view only but cannot edit."* Access is untouched; only the price is reserved.

### View stays, edit goes

- `PRICE_EDIT_ROLES` in `price-visibility.ts` moves from `["purchaser"]` to `["payment_approver"]`, matching the
  server rule in `price-authority.ts`. **`PRICE_ROLES` (viewing) is deliberately unchanged** — the Purchaser and
  everyone else who can open Inventory / Products still sees every price.
- The screens now say so instead of just failing on save: the Products supplier-price inputs go **read-only** with
  *"Prices are set by an Admin or the Payment Approver. You can still add suppliers and codes here."* Inventory
  already threaded `canEditPrices`, so its price edit simply disappears while the price columns stay visible.
- **Not widened:** the Warehouse still cannot *see* prices (`PRICE_ROLES` is purchaser / accounting / engineer /
  admin, by an older deliberate policy — money is hidden from Warehouse, Plant Manager, Logistics). The owner's
  sentence reads as "don't lock people out", not "show Warehouse the money", and quietly widening commercial
  visibility on an ambiguous reading would be the wrong way to be wrong. **Say the word if it was meant.**

### The override

- `POLine` gains an optional `priceOverride { reason, byName, at, catalogue }`. `catalogue` is the figure *at the
  moment of the override*, so the record still makes sense after the catalogue is later corrected.
- **The form** keeps the price read-only, with *different price…* to unlock it, a reason box, and a one-click way
  back to the catalogue figure. Unlocking resets when the supplier changes, because that refills every line and the
  old decision no longer refers to the same number. A saved override arrives already unlocked so its reason shows.
- **The server is the control.** `savePurchaseOrder` rebuilds the catalogue and refuses an unexplained deviation —
  *"BELT B-50 … is priced at 128 but the catalogue says 210. Give a reason…"*. A read-only input is a courtesy; the
  request can be replayed with any price.
- **Never a block on the price itself**, per the owner's choice: a supplier quoting something new on a Friday must
  not stop purchasing. The deviation is recorded and reviewed afterwards.
- **A re-save does not demand the reason again.** An untouched line carries its stored reason forward, and the
  original `byName` / `at` are preserved rather than restamped — otherwise fixing a typo in the remarks would
  rewrite who authorised the price and when.

### One builder, three consumers

- The catalogue build was inline in the Purchasing page and **copied again** by the audit; a third copy for the
  save would have been the drift this codebase keeps getting bitten by. It is now `src/lib/po-price-catalog.ts`,
  used by the save and the audit — the two that must agree.

### Verified — 11 new tests against a real Postgres

- **Catalogue (5):** the chosen supplier's own price; the lowest price when that supplier lists none; the inventory
  unit cost when no supplier price exists; `null` for an uncatalogued product; and 1 HP vs 2 HP motors priced from
  their **own** product.
- **Save gate (6):** the catalogue price saves silently; a different price with **no reason is refused and nothing
  is written**, naming both figures; with a reason it is stored and stamped with the purchaser's name, the time and
  the ₱210 catalogue figure; a re-save keeps the original stamp; an uncatalogued product is left alone; and going
  back to the catalogue price **clears** the override.
- Full suite 71 passed, 24 skipped (the DB-backed suites). Typecheck + lint + build clean. No migration —
  `priceOverride` rides in the existing `PurchaseRequest.po` JSON.
- **Still pre-existing:** the CEBDD `selectFan` failure on `main`.

## 2026-08-28 · The catalogue price belongs to the Admin and the Payment Approver

- **Owner's decision**, answering "is it alright to disallow the purchaser to change price in PO creation?":
  option **A and B together** — A moves who owns the price, B records any deviation at the line. This entry is A.
- **Why A alone would have been theatre.** The Purchaser already owned both catalogue screens: `Products` (admin +
  purchaser) and `Inventory` (admin + warehouse + purchaser). Locking the PO field and saying "change it in
  Products" would have moved the same person to a different tab to type the same number.
- **Only the PRICE FIELDS are reserved**, never the screens — new `src/lib/price-authority.ts`. The Warehouse still
  adjusts quantities; the Purchaser still adds items and products, sets suppliers, codes, units and categories.
  Locking the tabs would have stopped people doing their jobs.
  - Inventory: `unitCost` / `sellPrice` on create, on the meta edit, and in the bulk import.
  - Products: the supplier `price`, on create, on edit and in the import.
- **A non-owner is never refused — the price is simply left alone.** A Purchaser's new item is created *unpriced*
  rather than rejected, and their edit to a name, code or location lands while the price stays as approved. Refusing
  the whole save would have made an approved price a blocker on unrelated work.
- **Neither importer is a way round it.** Both drop the file's prices for a non-owner and **say so in the result** —
  a silently ignored column looks like a broken import, and this codebase has already been bitten by that.
- **A gap the tests caught, not the reading.** `requireProductManager` was admin + purchaser, so the Payment
  Approver **could not open Products at all** — they would have owned a figure they had no way to reach. They are
  now allowed in. Inventory needed no equivalent: `updateStockItemPrices` is already a price-only action, so the
  Payment Approver can set inventory prices without broader inventory rights.
- **7 tests** in `src/lib/price-authority.test.ts`, against a real Postgres (skipped unless `TEST_DATABASE_URL` is
  set). As much about what STAYS possible as what is blocked:
  - the authority admits Admin and Payment Approver, and refuses Purchaser and Warehouse;
  - the Payment Approver sets a supplier price; the Purchaser's price is ignored **but the product is still created**;
  - a Purchaser renaming a product and adding a supplier code keeps both edits while the approved ₱210 stands;
  - the Admin prices a stock item; the Purchaser's item is created with its **quantity and reorder level** intact
    and the price at zero;
  - the Warehouse's category / location / reorder-level edit lands while unit cost and sell price stay as approved.
- Full suite 71 passed, 13 skipped (the DB-backed suites). Typecheck + lint + build clean. No migration.
- **Part B is next**: the PO line price read-only by default, with a "use a different price" override that records
  who, when and why — kept open to the Purchaser, so a supplier's new quote never stops purchasing.

## 2026-08-28 · A new PO line starts at the catalogue price

- **Owner-instructed:** *"when creating PO get the item price in product tab or inventory tab — the price of 2
  sources are same."* Products and Inventory carry the same figure, so either answers the question.
- **The gap was a deliberate refusal.** `catalogReferencePriceFor` filled a new line only when the product had a
  **single unambiguous** price; when several suppliers listed *different* prices it returned `undefined` on the
  reasoning that seeding one supplier's price before the supplier is chosen might seed the wrong one. In practice
  that left the box **blank** — and a blank box gets filled from memory. That is how a PO reaches a price no
  supplier lists.
- **Now it always seeds the catalogue's figure**: the single price when suppliers agree, otherwise the reference
  price (lowest supplier price, else the inventory unit cost). Picking a supplier still force-overwrites with that
  supplier's own price, so the seed can only ever be replaced by something more specific. A real catalogue price
  that a supplier pick refines beats a blank that gets typed over.
- **The catalogue price is now visible on the line.** When a typed price disagrees with the catalogue, the
  catalogue figure appears under the box in amber — click it to apply. Previously a wrong figure was invisible
  until the PO had been approved, printed and vouchered. This is the "warn, don't block" answer to the question
  left open earlier: a negotiated price is legitimate, so it is shown, not prevented.
  - Uses the chosen supplier's price when they list one, else the reference figure — the same rule as the seed.
- **6 more tests** (17 in `po-catalog.test.ts` now): agreeing suppliers seed their common price; **disagreeing
  suppliers now seed rather than blank** — the behaviour change, locked in; no supplier price falls back to the
  inventory unit cost; an uncatalogued product still seeds nothing; a new PO fills every catalogued line; and a
  price already on the line is never overwritten (so a requisition's carried `@price` survives).
- Full suite 71 passed, 6 skipped. Typecheck + lint + build clean. No migration.
- **Still pre-existing:** the CEBDD `selectFan` failure on `main`.

## 2026-08-28 · The price audit stops reporting rounding

- **From the production list**: a VFD at **₱128,785.00** against a listed **₱128,786.15** — ₱1.15 on a ₱128k line —
  and a belt ₱0.60 out. In a list of thirty rows, noise like that hides the rows that matter.
- **Both tests must pass to suppress**: line-total impact under **₱20** *and* under **2%** of the line. Requiring
  both is what stops a tiny per-unit gap being dismissed on a huge quantity — ₱0.10 out on 10,000 pieces is ₱1,000
  and still reports.
- **Six assertions on the real figures** from that list: the VFD (₱1.15), BELT A-28 (₱1.20 line gap) and the IDEC
  switch (₱6, 1.06%) are suppressed; CRS ROD 5" (₱120 gap), STAIN. NUT (₱0.80 → ₱3.20, a 4× price) and the
  10-centavos-on-10,000-pieces case all still report.
- Full suite: 65 passed, 6 skipped. Typecheck + build clean. Read-only; no migration.

### Reading the production list that prompted this

The list the owner sent was produced **before the matcher fix** (`df86d78`, pushed but not yet merged), and it
contains its own proof of the cross-matching:

- **three different G.I. BOLT sizes on one PO** — 5/16 × 1, × 1/2, × 3/4 — all compared against **₱1.40**;
- **three PULLEY sizes** — 7-1/2", 5-1/2", 5" — all compared against **₱432**;
- **four motor ratings** all compared against **₱12,822** or **₱10,440**.

Those separate once the fix lands. Two findings in that list are NOT explained by the matcher and are worth the
owner's eye:

- **ANLY TIMER AH3NC (PO-618)** — PO ₱2,060 against a listed ₱1,030, **exactly double**, on qty 2. That is the
  signature of a line total typed into the unit-price box; the PO totals ₱4,120 for two timers.
- **BELT B-50 (PO-555)** — PO ₱225 against a listed **₱128**. The catalogue said **₱210** when this investigation
  started (PO 615, where the PO carried the ₱128). The product's price appears to have moved since; worth
  confirming which figure is right before correcting anything.

## 2026-08-28 · The product matcher could not tell a 2 HP motor from a 1 HP one

- **Owner-approved**, after the production Data check returned ~35 flagged PO lines and several looked wrong in a
  way that implicated the audit itself.
- **The real defect, and it is not in the audit — it is in the live PO price autofill.** `tokenize` in
  `po-catalog.ts` dropped every token shorter than two characters, which **erased the rating** from a whole family
  of products:

  ```
  INDUCTION MOTOR 2 HP, 1PH, 4 POLE …  → ["induction","motor","hp","1ph","pole","foot","mounted","teco"]
  INDUCTION MOTOR 1.5 HP, 1PH, 4 POLE… → ["induction","motor","hp","1ph","pole","foot","mounted","teco"]
  INDUCTION MOTOR 1 HP, 1PH, 4 POLE …  → ["induction","motor","hp","1ph","pole","foot","mounted","teco"]
  ```

  Three different motors, **identical token sets** — `1.5` split into `1` and `5` and both vanished. The
  cross-model guard written to stop `32CHH` matching `24CDH` had nothing left to guard with, so a 2 HP line matched
  the 1 HP product at ₱12,822. `G.I. BOLT 5/16 X 3/4` likewise matched `… 5/16 X 1`. **`matchKey` is what the PO
  form's autofill uses**, so picking a supplier could pre-fill a motor line with a different rating's price — a far
  better explanation for several flagged rows than anyone mistyping.
- **Fix — two rules, both needed**, and the second only surfaced because the first was tested rather than assumed:
  1. never drop a token carrying a digit;
  2. keep alphanumeric runs and decimals whole. A first attempt split `1ph` into `1` + `ph`, and that stray `1`
     satisfied the 1 HP product's guard, so 2 HP *still* matched 1 HP. Matching `[a-z0-9]+(?:\.\d+)?` keeps `1ph`
     and `1.5` intact and the confusion goes away.
- **11 tests in `src/lib/po-catalog.test.ts`** lock it in: all four motor ratings pick their own product, both bolt
  lengths stay apart, belts and angle bar still match through an order-reference suffix, and **both KDK cassettes**
  — the case the matcher was originally written to protect — still match, so one family cannot be fixed by breaking
  the other.
- **The audit also learned about units.** A PO priced per **piece** against a catalogue price per **box** is not a
  discrepancy, and reporting it as one buried the real ones (BLIND RIVETS ₱0.22 vs ₱170, CRS ROD ₱6,600 vs ₱100).
  New `unit_mismatch` kind with a `pc/pcs/piece/each/unit` alias table, shown separately, sorted last, and offering
  no "would be" figure — called out rather than hidden, since a PO priced in the wrong unit is its own problem.
- **Verified end to end against a real Postgres**, 7 assertions: a 2 HP line at its own correct price is **no longer
  flagged at all** (a whole class of false positive gone); a 2 HP line priced at the 1 HP figure **is** flagged and
  compared against the right product; per-piece vs per-box classifies as a unit mismatch with no correction
  suggested; the inventory-cost signature still fires; unit mismatches sort last.
- Full suite: 65 passed, 6 skipped (the DB-backed inventory tests). Typecheck + lint + build clean. No migration.
- **The earlier production list should be re-read after this deploys** — a good share of those ~35 rows were the
  audit comparing against the wrong product, and will disappear.
- **Still pre-existing and untouched:** `selection.test.ts > selectFan — direct drive (CEBDD) … 4-pole band` fails
  on `main` too.

## 2026-08-28 · Inventory import can rename an item, and a ghost stops blocking it

- **Reported:** re-importing the stock list returned *"Item Code CAT00100 is already used by another item"* on three
  rows, while three others updated fine.
- **Two defects, both certain from the code:**
  1. **Renaming was impossible.** The update path wrote sku, barcode, unit, category, location, reorder level, unit
     cost, sell price and quantity — **never `name`**. So the round trip this panel advertises (Download Excel →
     edit → Import) could change every field except the one people most often fix.
  2. **The guard counted deactivated rows.** It rejected a row whenever *any* item held the code under a different
     name, with **no `active` filter** — yet "Clear all" and "Merge duplicates" only DEACTIVATE, keeping the code.
     A merged-away ghost therefore blocked its own live item permanently. The page in the screenshot shows
     *"Merge duplicates (4)"* and *"Possible duplicate items (5 groups)"*, so ghosts exist in this data.
  Either defect alone produces the reported error.
- **The Item Code now identifies the item.** When exactly one live item holds it, that IS the row's item and its
  name may change. Errors remain for the cases that are genuinely ambiguous, and **name the offender** — the old
  message never said which item was in the way, so it could not be acted on:
  - the code is spread over several live items → *"…is shared by more than one item (“ITEM ONE”, “ITEM TWO”). Merge
    or re-code them first."*
  - the new name already belongs to a different item → *"Renaming Item Code … (currently “…150mmØ SS201”) to “TAKEN
    NAME” clashes with the existing item CAT00300."*
- **A rename must target the row it resolved**, not re-look-up by the new name — that would find nothing and create
  a duplicate under the code that is about to move. The lookup now starts from the resolved id.
- **My first rule was wrong and the tests caught it.** It treated any differing owner as a rival, so the inactive
  ghost still blocked CAT00102 — the very case the change exists to fix. Only *live* items compete for a code now.
- **Six tests, `src/app/(app)/inventory/import-stock-items.test.ts`**, against a real Postgres (skipped unless
  `TEST_DATABASE_URL` is set, so `npm test` stays green without one):
  - renames three items in place — 3 updated, 0 created, no errors, and the 100mm item keeps its **quantity 3** and
    its row identity, so stock and ledger history survive;
  - a deactivated duplicate holding the same code no longer blocks;
  - a code shared by two **live** items is still refused, and the message names both;
  - a rename onto a taken name is refused, naming the current name and the clashing code;
  - re-importing an unedited file changes no values (only `updatedAt` moves — the import rewrites identical values,
    which is pre-existing);
  - a genuinely new item is still created with a generated code.
- Panel copy corrected: it claimed matching was by **name** when the code already took precedence, and never
  mentioned the `sku` column that Download Excel emits — which is what makes the round trip work at all.
- Typecheck + lint + build clean. No migration.
- **Pre-existing failure, untouched:** `selection.test.ts > selectFan — direct drive (CEBDD) … 4-pole band` fails on
  `main` too (expected 2 to be 4). Unrelated to this change; flagging rather than fixing, since it is fan-selection
  logic.

## 2026-08-28 · Correction: the ₱128 did not come from inventory cost

- **My earlier diagnosis was wrong, and the page shipped saying so.** I claimed PO 615's ₱128 came from the seeding
  fallback *"lowest supplier price, else the stock item's unit cost"*, assuming BELT B-50's unit cost was ₱128.
  **It is ₱210** — owner supplied the Inventory screen showing it. Corrected in `src/lib/po-price-audit.ts` and in
  the Data check copy.
- **Re-traced every automatic path, and all of them give ₱210:**
  - the chosen supplier's catalogue price — WINGS lists ₱210;
  - the reference price — `min(supplier prices)` = ₱210;
  - the stock unit cost — ₱210;
  - the description matcher — verified directly: `poLineFromPRItem("2 pcs · BELT B-50 (JO 2600080)")` parses to
    qty 2 / unit `pcs` / description `BELT B-50 (JO 2600080)`, which `matchKey` resolves to the `belt b-50`
    product, returning WINGS ₱210. So auto-fill was working and would have offered ₱210.
  - the embedded `· @<price>` marker — real, and it *does* override the catalogue (it arrives as a pre-filled
    price, and `withCatalogPrices` only fills blanks). But it has exactly **one writer**,
    `autoRaiseBoughtInRequisition`, on the ORDER bought-in path. PO 615 is a **department** requisition (Fans &
    Blower, JO 2600080), which never carries the marker. Ruled out.
- **So the ₱128 was not produced by the catalogue.** It was typed, or filled when the catalogue held a different
  price. Which of those cannot be told apart from the data — nothing records the origin of a line price.
- **The actual defect is the absence of a check, not a bad source.** Once a price is in the box **nothing ever looks
  at it again**: `withCatalogPrices` fills blanks only (it overwrites solely when the supplier is re-picked), and no
  later step — save, approve, print, voucher — compares the line to what the supplier lists. A wrong figure travels
  untouched to a signed voucher. That is why the audit page exists, and its copy now says this rather than the
  inventory-cost story.
- The `inventory_cost` classification is kept — it is a real signal if it ever occurs — but is no longer presented
  as the cause. PO 615 classifies as **`differs`**, which is correct: ₱128 is a price no supplier lists.
- Typecheck + build clean. Still read-only; no migration.
- **Owner's instruction for the fix:** *"Do not stop from seeding in Inventory or Products… Make other way to wire
  the supplier price to PO."* So the seeding stays; what is missing is the PO form showing the supplier's listed
  price against each line and flagging a disagreement before the PO is approved. Phase 4 is frozen — awaiting
  approval of the specific change.

## 2026-08-28 · Data check: PO line prices against the product catalogue

- **Reported:** PO 615 bought BELT B-50 at **₱128** while both of that product's suppliers list **₱210** — 2 pcs
  billed at ₱256 instead of ₱420. Owner asked whether it happened elsewhere.
- **Found the mechanism, in Phase 4's own price seeding.** A PO line's price is filled from the catalogue; when the
  chosen supplier has no saved price the fill drops to the REFERENCE price, defined in
  `src/app/(app)/purchasing/page.tsx` as *"lowest supplier price, else the stock item's **unit cost**"*. That last
  fallback is the trap: **inventory unit cost is a costing figure, not an offer from a supplier**, so a line seeded
  from it goes out at a price nobody quoted. ₱128 is BELT B-50's unit cost; ₱210 is what the suppliers sell it for.
- **New read-only section on Admin → Data check**, `src/lib/po-price-audit.ts`, checking every priced PO line
  against the catalogue and splitting the results, because the two kinds are not equally suspicious:
  - **`inventory_cost`** — the line's price equals the stock unit cost and **no supplier lists that price**. The
    signature of the fallback, and the strongest evidence of a genuinely wrong price. Sorted first.
  - **`differs`** — simply not what the supplier lists now.
- **The audit reuses the seeding logic rather than re-implementing it.** It builds the catalogue exactly as the
  purchasing page does and resolves descriptions through `matchKey` — the same matcher — so the audit and the
  seeding can never disagree about what a product costs, and `BELT B-50 (JO 2600080)` resolves the same way in both.
  `matchKey` gained an `export` keyword; no behaviour changed, and a local copy would have been the thing that
  drifts.
- **A caveat that stays attached to every row**, in the UI as well as the code: **a PO legitimately records the
  price agreed at the time.** A supplier that raised its price later makes a difference *history*, not an error. The
  audit narrows 1000+ lines to a handful worth looking at; it does not decide them.
- **A trap caught by testing rather than reading.** The first version read the stock cost via `fallbackPriceFor`,
  which returns the **reference** price — the lowest *supplier* price whenever the product has one. For BELT B-50
  that is ₱210, so the check compared 210 against 210 and classified the reported line as a plain "differs",
  missing the very signature it was built to find. The unit cost now comes from the inventory map directly.
- **Verified with 13 assertions** against a real Postgres seeded to the reported shape — two suppliers at ₱210, a
  stock item at ₱128, and a neighbouring BELT B-40:
  - flags PO 615, classifies it `inventory_cost`, reports ₱128 vs ₱210, identifies the ₱128 stock cost, and
    computes ₱256 → **₱420**;
  - catches a second item seeded from its own ₱99 unit cost **without confusing it with B-50**;
  - stays silent on the correct price carrying a `(JO …)` suffix, on the second supplier at the same price, and on
    B-40 at its own price;
  - ignores an item absent from the catalogue instead of guessing;
  - sorts `inventory_cost` above `differs`.
- Typecheck + lint + build clean. Read-only; no migration.
- **Not changed — Phase 4 is frozen.** The fallback that causes this is still live. Fixing it (stop seeding a PO
  price from inventory unit cost, or mark such a line as unpriced so the purchaser must enter one) needs the owner's
  approval, as does correcting PO 615's ₱128.

## 2026-08-28 · Duplicated quotations stop inheriting the original's order

- **Owner-approved**, following the production scan: 3 of 1047 quotations affected, in two different shapes.

### The fix — the deny-list becomes an allow-list

- `duplicateQuotationToCustomer` copied the source's whole `classification` and deleted three keys (`sale`,
  `revision`, `revisions`). That list was written **before the order workflow moved into the same blob** and was
  never revisited, so every duplicate inherited `classification.workflow` — the source's stage, approval stamps,
  job orders, MRFs, delivery batches and closing documents. Nothing anywhere resets it, so a won duplicate could
  show as already **closed** having done no work. It also carried `saleDocReads` / `slipValidations` keyed to the
  **source order's files**, plus `followUp`, `sentAt`, `revisedAt`, `revisionRestore` and both AI read counters.
- Now inverted: **nothing crosses unless it is named or provably product-side.** The default is drop, which is what
  makes it safe against the next key someone adds — the exact way this broke.
- The invariant that makes an allow-list possible here: the builder's own classification fields are plain
  **strings**, while every piece of order / sale / document state is an object, array or number. Only two lifecycle
  values are strings (`sentAt`, `revisedAt`) and they are named. `pricing` is carried explicitly.
- Worth recording: `meta.classification` is typed `Record<string, string>` but **the builder never sends it** —
  product data lives per-item in `specsSnapshot`. So that blob is lifecycle state almost end to end, which is why
  an allow-list this small is correct rather than lossy.

### The repair — one write, and the guard is the whole point

- New **Admin → Data check** action: clear a wholly-inherited workflow so the order restarts at Phase 1, and drop
  document reads pointing at another order's files.
- **It refuses unless EVERY dated step predates the quotation.** The scan found two shapes and only one is safe to
  clear:
  - **3276J** — 21 of 21 steps inherited, including duct job orders, proofs and the final payment check. It has
    done none of its own work. Safe to reset.
  - **3020J / 2941J** — 1 of many. They inherited a single `doc_check` and then ran the rest of the workflow
    **legitimately**; both are genuinely closed. Clearing those would destroy weeks of real production and delivery
    records, so the action refuses and the page explains why instead of offering a button.
- The guard is recomputed **from the database inside the action**, never taken from the page, so a stale or edited
  request cannot get past it. Two-step confirm in the UI is a courtesy, not the guard.
- The order's own `sale` — arrangement and payments — is its own and is never touched. Only *foreign* document
  reads are removed; the order's own are kept. Every reset appends to `classification.workflowResets` with who,
  when, how many steps and which source, because a closed order silently returning to Phase 1 would be worse than
  the bug.

### Verified — 28 assertions against a real Postgres

- The allow-list drops all 12 lifecycle keys, keeps `pricing` and a builder string, and a duplicate now opens at
  `payment_review`.
- The scan separates the two shapes (3/3 vs 1/3).
- **The guard refuses the partly-inherited order** — *"2941J did 2 of its own workflow steps, so its workflow is
  not purely inherited"* — and that order is left closed and untouched.
- The wholly-inherited one restarts at `payment_review` while **keeping its own payment record and its own document
  read**; its foreign `slipValidations` is removed entirely; an audit note is written; and the scan afterwards
  reports only the partly-inherited order.
- Typecheck + lint + build clean. No migration.

### Left alone deliberately

- **3020J and 2941J keep their false `doc_check` stamp.** Owner's call, taken on the reasoning that stripping an
  approval from an already-closed order muddies the audit trail more than a wrong name and date does. The page now
  states plainly what those two inherited and that the step was never actually performed for them.

## 2026-08-28 · Data check: how much of an order is inherited, not just that some is

- **The production scan found 3 of 1047 quotations affected**, and they are not the same problem — which the page
  could not show, because it only reported the count of inherited steps, never the total:
  - **3276J** (MALERA, dup of 2892J) — **21** predating stamps including duct job orders, proofs and the final
    payment check, plus a `slipValidations` entry pointing at another order's deposit slip.
  - **3020J** (INOVUS, dup of 2648J) and **2941J** (H&H, dup of 2803J) — **1** predating stamp each, both
    `approvals.doc_check.at`, both dated 3 Aug ~10:05.
- **So the page now prints "N of M recorded steps"** and says which case it is in plain words: *"Every recorded step
  came from the other order — this order has done none of its own"* versus *"The remaining N happened after this
  order was created, so they are its own work."* That one ratio is the whole diagnosis, and it decides the repair:
  a wholly inherited order never ran its workflow and must restart, while an order with one inherited step was
  worked properly and merely started one step ahead. Repairing those two the same way would destroy real work.
- **The production data corrected two of my assumptions**, both harmlessly:
  - The real stamp keys are **snake_case** (`doc_check`, `payment_cleared`, `jo_received`, `client_notified`,
    `final_pay_checked`) — my seed had guessed camelCase. The detector walks the blob for *any* ISO timestamp
    rather than looking up known keys, so it never depended on the naming. That generality is why it worked
    first time against real data.
  - The workflow holds far more dated events than approvals — `jobOrders.duct.issuedAt`, `startedAt`,
    `finishedAt`, `proofs.0.uploadedAt`, `ductJobOrders.0.approvedAt`. All correctly counted.
- **Fixed a copy bug in the singular case**: "1 document read **point** at another order's files" → "points".
- Verified by rendering the page against both shapes seeded from the real numbers: 5-of-5 reports "none of its
  own", 1-of-4 reports "the remaining 3 are its own work".
- Typecheck + lint + build clean. Still read-only; no migration.
- **Outstanding, both awaiting the owner and both frozen-area:** the code fix in `duplicateQuotationToCustomer`
  (invert the deny-list to an allow-list), and the repair of the three orders — which now needs two different
  treatments, not one.

## 2026-08-28 · Admin → Data check: which orders are carrying another order's state

- **The scan is now a page, not a command.** Admin → **Data check** runs it with the credentials the app already
  holds, so answering "is this order really finished, or is it wearing 2892J's stamps?" is a click. The
  command-line form asked the owner to clone the repo, install Node and paste a production database password into a
  terminal — for a question that needs answering once.
- **Nothing on the page can change an order.** It reads and prints; there is no action, no button, no write path.
  That matters because the underlying subject is the frozen order workflow, which is untouched by this change.
- **One detector, two front ends.** The logic moved into `src/lib/inherited-workflow-scan.ts`; the page and
  `scripts/scan-inherited-workflows.ts` both call it, so they cannot drift into disagreeing about what counts as a
  hit. The script is now printing only.
- **Two tests, neither of which can fire on a clean order:**
  - **Time travel** — an approval stamp dated *before the quotation itself existed* cannot be that order's own
    work. This is the decisive one: it needs no knowledge of how the row was created, so it catches inherited state
    from any route, and it still fires on a duplicate that was later worked on legitimately.
  - **Foreign file paths** — `saleDocReads` / `slipValidations` are keyed by storage path, and an order's paths all
    start `sales/<that order's id>/`. Anything else came from another order.
- **Verified by rendering the page itself, in both states**, against a seeded database — not by reading the JSX.
  With the bad row present it reports *"1 order affected"*, names the quote, shows `stage: closed`, lists all seven
  predating stamps and both foreign paths. With the inherited blob removed it flips to *"Clear — No order is
  carrying state from another order."* The four seeded cases also confirm it stays quiet where it should: the
  legitimately-worked source order, a clean order with its own workflow, and an unaffected duplicate are all left
  alone.
- **Still not run against production** — this session has no database credentials, only `.env.example`. The page is
  the delivery mechanism for that.
- **Two small facts worth recording**, both found by hitting them:
  - `WON` is an **Inquiry** status, not a `QuotationStatus` (which is `DRAFT | PENDING_APPROVAL | APPROVED | SENT`).
  - `Customer` has no `createdById`.
- Typecheck + lint + build clean. No migration.
- **The bug itself is still unfixed and the affected order still needs repairing** — both are frozen-area changes
  awaiting the owner's go-ahead. This change only makes the damage visible.

## 2026-08-27 · Catalogue backup: download the lot, edit it, upload it back

- **New on Admin → Catalogue: a "Backup & bulk edit" card** with *Download Excel*, *Download CSV* and *Upload
  Excel / CSV*. The download is the upload format, so a backup is a restore and a spreadsheet edit is a bulk update.
- **Upload reuses the existing catalogue importer** (`/api/admin/import`, type `catalogue`) rather than growing a
  second one. It already validates every row in memory before touching the database, reports failures per row
  without aborting the batch, and matches on `modelCode` — which is what makes a re-upload an *update* instead of a
  pile of duplicates. Nothing is ever deleted by uploading.
- **Export is a new admin-only route** `/api/admin/catalogue/backup?format=csv|xlsx` (`src/lib/catalogue-backup.ts`
  + `src/app/api/admin/catalogue/backup/route.ts`). Deliberately **not** the existing `/api/catalogue/export`, which
  is a short SKU list for pickers and drops price, description and specs — fine for looking things up, useless for
  putting things back.
- **Two things a backup must get right, and neither was free:**
  - **`active` had to survive.** The importer ignored the column, so restoring a backup would have quietly switched
    every disabled item back on. It now reads `active` (`true/yes/y/1` / `false/no/n/0`, case-insensitive).
  - **Excel must not "helpfully" retype model codes.** Every column in the workbook is forced to text (`numFmt
    "@"`), or `25GSC` survives but something like `1E5` comes back as `100000`. The CSV leads with a BOM and uses
    CRLF so Excel opens it as UTF-8 — otherwise `₱` and `Ø` arrive mangled.
- **A real footgun in the shipped feature, found by testing rather than reading, and fixed.** The importer treated a
  *missing column* the same as an *empty cell*, so uploading a three-column sheet of corrected names would have
  silently wiped every description, size and spec on the rows it touched. Missing column now means **leave it
  alone**; a column that is present but blank still clears. `modelCode`, `family` and `name` stay required. This is
  a behaviour change to shared import code and it can only prevent data loss, never cause it — the Import CSV tab
  supplies the full column spec, so its behaviour is unchanged.
- **Verified against a real Postgres, 15 assertions**, on data picked to break naive CSV: embedded commas, escaped
  quotes, a newline *inside* a product name, `₱`/`Ø`/`—`, an inactive item and one with no price row at all.
  - export → wipe the whole catalogue → import → **snapshot identical**;
  - re-upload the same file → 4 updated, 0 inserted, still 4 items, still identical (idempotent);
  - narrow sheet renames without touching description / sizeLabel / specs / price, and does not reactivate the
    disabled item; a present-but-blank cell does clear;
  - bad family, bad `active` and a missing `modelCode` are reported as rows 3, 4, 5 while the good row still lands;
  - the xlsx re-read through the uploader's own path returns every model code as text.
  - (One assertion failed first time and was **my test's fault, not the code's** — Postgres `jsonb` reorders object
    keys, so `{"drive":…,"hp":…}` comes back `{"hp":…,"drive":…}`. Compared as parsed objects, the specs were intact.)
- **Auth is checked twice.** The `/admin` layout guard does not cover `/api/*`, so the route re-checks `isAdmin`
  itself; signed out, middleware turns it away at the edge first (both confirmed, 307 and 403 paths).
- Typecheck + lint + build clean; the only lint warning is the pre-existing `alt-text` pair in `quotation-pdf.tsx`.
  No migration — no schema change, `active` was already on the model.
- **Not done, deliberately:** the xlsx→CSV conversion now exists in three places (the Import CSV tab, the suppliers
  manager, and this card). Folding them into one helper is a refactor of two working screens and belongs in its own
  change, not smuggled into this one.

## 2026-08-27 · The trust band's icon squares grow 20%, and finally match

- **Box `39px` → `47px`, icon `17px` → `20px`** — the requested 20%, on both.
- **"Identical" needed more than a size.** The four squares were the same box all along; what differed was what sat
  inside. They were **text characters** — `⌂ ✓ ⚙ →` — so each glyph came from whatever font the browser substituted
  for that codepoint, arriving at its own weight, size and baseline, and differing again from machine to machine.
  No amount of `text-[17px]` fixes that. They are now `lucide-react` icons drawn on one 24×24 grid at one stroke
  weight (2.25), so the four are identical **by construction** rather than by coincidence.
- **The symbols do not change.** Each key maps to the icon its character was already producing — house, tick, gear,
  arrow — so nothing on the page changes shape, only weight and alignment. (`factory → Home`, `check → Check`,
  `wrench → Settings`, `truck → ArrowRight`, plus `shield`, `support`, `settings` for themes that set them.)
- **The bigger box broke the fourth card, and that was caught by measuring rather than looking.** At 1440 the extra
  8px squeezed "Serving clients across the Philippines" onto two lines and pushed the band from **91px to 114px**.
  Card padding `px-6` → `px-5` gives back exactly the 8px the box took, and all four bodies are back on one line;
  the band settles at **96px**, the 5px being the taller box and nothing else.
- **Checked against `main` at three widths** so the fix was not confused with a pre-existing wrap: 1440 and 1280 are
  one line before and after; **1024 wraps identically in both** (band 133px, three-line bodies) — that is the
  `lg:grid-cols-4` breakpoint being tight at exactly four columns, and it is untouched here.
- Typecheck + lint + build clean. UI-only, no migration, no workflow touched.

## 2026-08-27 · The logo takes the navbar's colour

- **The complaint reproduced, on the scrolled store header.** The sticky header is `bg-white/95` over a
  `backdrop-blur`, so once it slides over the dark hero it composites to **242,243,244** — while the logo's own
  baked-in white stayed **255,255,255**. That 13-level gap is the white rectangle. At the top of the page there is
  nothing dark behind the bar yet, both are 255, and nothing looks wrong — which is why it only shows on scroll.
- **`public/aerovent-logo.jpg` is not a JPEG.** It is a 455×103 **PNG with no alpha** — an opaque white rectangle
  with the artwork sitting on it. It can only ever blend on a surface that is exactly `#ffffff`.
- **Fixed on the logo side, which is what was asked**: the white is keyed out, so the logo's background *is* the
  navbar, in every scroll state and on any future navbar colour. The alternative — forcing the header opaque
  (`bg-white`) — would have papered over it by throwing away the frosted-glass header.
- **The key is feathered and un-premultiplied**, not a hard threshold. Alpha ramps over distance-from-white 3→70, and
  each partial pixel's colour is recovered with `F = (C − (1−a)·255) / a`, so anti-aliased edges carry the right
  colour on *any* background instead of a white halo.
- **Verified it changes nothing on white.** Composited back over `#ffffff` and diffed against the original:
  **mean 0.19, max 3** across 140,595 samples. Every other surface that shows this logo — app sidebar, mobile top
  bar, login / forgot / reset cards, the disabled-role card, the MRF and PO print sheets — is pure white, so all of
  them render as they did. Then measured on the page: scrolled, the logo's background and the bar beside it are both
  **242,243,244**; at the top, both **255,255,255**.
- **The filename stays `/aerovent-logo.jpg`** even though the bytes are a PNG, exactly as before. `src/middleware.ts`
  allowlists that literal filename, so renaming it would 307 signed-out visitors to `/login` and the logo would
  vanish from the storefront and the login page.
- Typecheck + build clean. Asset-only, no code change, no migration, no workflow touched.

## 2026-08-27 · The hero halo grows another 50%

- **`r="130"` → `r="195"`** on the backlight circle behind the propeller — half again what it was, so the light
  spreads well past the blade tips instead of stopping just outside them.
- **This is the size at which the halo stops fitting**, and that needed fixing rather than flagging. An `<svg>` clips
  to its own viewport by default, so at r=195 the glow — still around 10% opaque where it meets the 200×200 box —
  would have been sliced off square, painting a faint **rectangle** into the hero. The svg now carries
  `overflow-visible`, so the light spills past the 340&nbsp;px box and fades out on its own; the hero `<section>`
  (which is `overflow-hidden`) is what finally bounds it.
- Verified on a running store page across the full-width hero, and the applied style probed rather than eyeballed —
  computed `overflow: visible`, glow `r=195`, box still 340×340 — because a Tailwind utility that silently fails to
  compile is exactly the kind of thing that would leave the rectangle in place.
- Nothing else about the artwork changes: blade path, tip bands, decal, hub, collars, AFBM letters, zero sweep, 7s
  anticlockwise spin, reduced-motion guard.
- Typecheck + lint + build clean. UI-only, no migration, no workflow touched.

## 2026-08-27 · The hero propeller's backlight widens

- **The artwork is the five-blade black propeller again**, exactly as it was signed off — same plan-form, matte-black
  gradient, twin tip bands, copper decal, hub, collars, bolt circle, AFBM letters, zero sweep, 7s anticlockwise spin.
- **The one change: the backlight halo is 30% wider.** `r="100"` → `r="130"` on the glow circle behind the rotor. The
  gradient fades to nothing well before its own edge, so nothing visible is clipped by the 200×200 viewBox; the halo
  simply reaches out past the blade tips instead of hugging the hub.
- **Everything explored in between was dropped, on the owner's word.** In order: the six-blade **blue impeller**
  reproduced from the reference photo (`eaf7295`), a six-blade **black** propeller from an intermediate reading of
  *"do not change the propeller blade"* (`db947e2`), and a zero-pitch impeller that was never committed. All
  superseded — *"revert to this design"*, with the original five-blade propeller attached. Both commits stay in the
  branch history as the steps they were; the diff that actually lands against `main` is the four-line halo change
  above.
- **The mock-up at `claude.ai/code/artifact/305c0b4b-2e5d-49a0-90ed-2a17b7196496` documents the abandoned impeller**,
  not what ships. Left as a record.
- Verified on a running store page at the hero's own size. Typecheck + lint + build clean. UI-only, no migration,
  no workflow touched.

## 2026-08-27 · The blue impeller takes the hero

- **The artwork is now the owner's impeller photo**, replacing the black five-blade aircraft propeller: six blue
  stamped-steel paddles at 60°, each on a short neck off a six-arm spider, under a plain domed hub.
- **The blade is reproduced, not restyled** — owner-instructed: *"do not change the appearance or construction of
  the propeller blade in the 1st picture"*. So it is a flat rectangle of near-constant width with generously
  rounded corners, and the real daylight between neighbouring blades is kept. An intermediate pass had tapered the
  paddles into wedges to close those gaps; that was wrong and was undone.
- **Pitch is what makes it a fan.** Each paddle is rotated 21° about its own centre. Drawn square it would be a
  daisy of rectangles; the lean is what the real blade does and what gives the photo its pinwheel read.
- **AFBM lettering is gone**, because the photo carries no markings and painting letters on would change the blade's
  appearance. This is the one open question — the mock-up has a *Paint AFBM on* toggle so the owner can compare and
  say. Everything else about the hero (size, float, 7s anticlockwise spin, reduced-motion guard, and the rule that
  an uploaded flagship hero photo still replaces the artwork) is untouched.
- **Two earlier readings, both superseded.** *"Change the propeller with the propeller from the photo"* first
  produced the impeller; *"do not change the propeller blade"* was then read as keep-the-approved-blade, which gave
  a six-blade **black** propeller (commit `db947e2`). The third message settled it: the blade to leave alone is the
  one in the photo. `db947e2` stays in the branch history as the step it was.
- Verified on a running store page at the hero's own size, and in a before/after mock-up with spin, lettering and
  theme toggles: `claude.ai/code/artifact/305c0b4b-2e5d-49a0-90ed-2a17b7196496`.
- Typecheck + lint + build clean. UI-only, no migration, no workflow touched.

## 2026-08-27 · The hero propeller gains a sixth blade

- **The blade itself does not change.** Owner-instructed, mid-change: *"do not change the appearance or
  construction of the propeller blade"*, then *"maintain the 6 blade construction"*. So the blade count comes from
  the impeller photo and everything else stays the propeller that was already approved — same plan-form path, same
  matte-black gradient, same twin tip bands, same copper decal, same hub, collars and bolt circle, same zero sweep,
  same 7s anticlockwise spin, same reduced-motion guard.
- **The whole diff is two lists**: `ANGLES` `[0, 72, 144, 216, 288]` → `[0, 60, 120, 180, 240, 300]`, and the
  matching `BLADES` entries. A collar is drawn per angle, so the sixth collar comes for free.
- **AFBM still lands on the first four blades.** Four letters over six blades leaves the last two plain, the way the
  fifth was plain before.
- **A first pass went too far and was reverted.** Read literally, "change the propeller with the propeller from the
  photo" meant redrawing the artwork as the blue stamped-steel impeller — six blue paddles, pitched 19°, on a plain
  disc hub. That necessarily replaced the blade, which is exactly what the owner then ruled out. The working tree was
  restored to `origin/main` before anything was committed, so none of it is in history. Mock-up of that abandoned
  direction, kept only as a record: `claude.ai/code/artifact/305c0b4b-2e5d-49a0-90ed-2a17b7196496`.
- Verified on a running store page at the hero's own size, and in a five-vs-six mock-up with spin and lettering
  toggles: `claude.ai/code/artifact/f0d185aa-2430-4d83-a9ac-fe651eba3c6c`.
- Typecheck + lint + build clean. UI-only, no migration, no workflow touched.

## 2026-08-27 · The job order's Project code fills itself

- **Where the earlier EWF came from.** Traced, because it looked like it contradicted the "Project is blank" finding.
  It did not: autofill wrote `""`, and the edit form's Project `<select>` carries an explicit `— select —` empty
  option, so a blank value stays blank and never silently adopts the first entry. **A person picked EWF.** The wiring
  the owner remembered is `resolveTag` in `lib/fan-body-factors.ts` — a complete product-type → fan-code map that
  builds the model code (`AV4800`**`EWF`**`3K3F3T`) and keys the body-cost table. It was simply never used here.
- **The old code scanned the model STRING** against a hardcoded list of six *centrifugal* codes
  (`CFABCAB, CABSISW, CEBCAB, CFAB, CEB, CAB`), so every non-centrifugal job order came out blank.
- **Now it asks `resolveTag`**, the same function the quotation uses, so the job order and the quotation cannot
  disagree about what the unit is.
- **A third bug this exposed.** `DIDWCEB` was not in that list at all, so `AV1225`**`DIDWCEB`**`15K3F2T` matched the
  shorter `CEB` — and **CEB is not an option on the DIDW sheet** (its dropdown is DIDWCEB / DIDWCFAB / CEBCAB /
  CFABCAB). The old code was writing a value that would fail the sheet's own data validation. Now `DIDWCEB` /
  `DIDWCFAB`.
- **Codes no sheet lists.** Seven products carry a code no dropdown offers — JF, SIEB, HPB, CMH, CMA, CMB, CPF. The
  sheet's **base** code is used for those, since it is the only thing an engineer could pick anyway. Owner-confirmed:
  **JF → TAF/VAF sheet, SIEB → CIEB, and HPB / CMH / CMA / CMB / CPF → CEB.** (`CMB` is the third Radial Blower —
  Backplate Paddle Wheel, alongside CMH Paddle Wheel and CMA Ring Paddle Wheel.)
- **Direct drive — corrected by the owner.** A first pass gated the `DD` suffix on `TAG_FACTORS`, which lists only
  `EWFDD`, `FAWFDD`, `PRVDD`, `TAFDD` and `VAFDD`, and concluded `CEBDD` was not real. **It is** — owner-stated:
  direct-drive CEB is CEBDD. That table is a register of pricing *factors*, not of codes, and reading it as the
  latter was over-reaching. `DD` now applies to **every** family, which is also exactly what the edit form does when
  Direct is ticked, so autofill and a hand-edited job order agree.
  - Verified belt vs direct across all 14 families: `CEB→CEBDD`, `CFAB→CFABDD`, `CABSISW→CABSISWDD`,
    `DIDWCEB→DIDWCEBDD`, `CIEB→CIEBDD`, `TAF→TAFDD`, `VAF→VAFDD`, `EWF→EWFDD`, `FAWF→FAWFDD`, `PRV→PRVDD`.
- **One source of truth for the dropdowns.** The six per-template code lists moved from the form component into
  `lib/job-order.ts` (`JO_PROJECT_CODES`, `joProjectCodes`), which the form now imports. The generator could not
  reach them before, and two copies would have drifted.
- **Verified across every fan type — 26 lines, 26 filled, 0 blank**, each with its template beside it, and a
  before/after diff on real centrifugal model codes: five rows byte-identical, and only the two DIDW rows changed —
  the correction above.
- Typecheck + lint + build clean. No migration.

## 2026-08-27 · CANCELLED and REJECTED behave like the terminal states they are

- **Owner-approved.** Both are terminal and both mean *not live*, so anything asking "is there work in flight?" must
  exclude both. They differ in one place only: **re-raising**. A cancellation is a *withdrawal* — nobody judged it,
  so raising again is the normal recovery path. A rejection is an approver's **decision**, and a side effect must not
  overturn it. Owner settled the policy: after a rejection, autofill does **not** raise a fresh one.
- **`autoRaiseBoughtInRequisition` had all three backwards.** The dedupe guard counted anything *not* REJECTED and
  *not* COMPLETED, so:
  | Existing requisition | Was | Now |
  |---|---|---|
  | **CANCELLED** | blocked — re-clearing payment silently created **nothing** | **raises** |
  | **REJECTED** | raised a fresh one, quietly reversing the approver | **blocks** |
  | **COMPLETED** | raised a fresh one — the items were already bought and received | **blocks** |
  The rule collapses to one line: **only a cancellation lets a fresh one be raised** —
  `status: { not: "CANCELLED" }`.
- **The CANCELLED case was the worst of the three**, because it failed *silently*: no duplicate, no error, just
  nothing created.
- **`finance-monitor` made the same slip**, counting CANCELLED requests as pending purchases and inflating the
  figure on the management dashboard. `notIn` now covers all three terminal states.
- **Verified against a real database**, seeding one requisition in **every** `PurchaseRequestStatus` and running the
  old and new predicates side by side — 19 checks:
  - The three rows above changed, and **only** those three.
  - All **14** in-flight states (PENDING_APPROVAL through PLANT_APPROVED) still block, unchanged.
  - No prior requisition at all still raises.
  - Finance monitor: pending 15 → 14, dropping exactly the one CANCELLED row it had been counting.
- Typecheck + lint + build clean. No migration.

## 2026-08-27 · Admin / Payment Approver get an editable Panel Fan job order

- **Request (owner).** On the Panel Fan JO, let the **admin / payment approver** edit the Excel that
  *Print Job Order* produces.
- **It was not the code — the templates ship protected.** Nothing in the route or the builder ever added
  protection. Auditing all six Fans & Blowers templates:
  | Template | Protection |
  |---|---|
  | Centrifugal Blower, DIDW, Inline, Tubeaxial/Vaneaxial | element present but **off** — always been editable |
  | **Panel Fan** | **on** |
  | **Power Roof** | **on** |
  So the owner hit the one they use; **Power Roof has the identical problem** and was fixed with it.
- **And it is password protection.** `sheetProtection` carries an SHA-512 `hashValue` + `saltValue` +
  `spinCount`, and `workbookProtection` adds `lockStructure="1"`. Excel's *Unprotect Sheet* asks for a password
  nobody has, so the recipient could not lift it themselves — this was a hard block, not an inconvenience.
- **Fix.** `buildFansJobOrderWorkbook` takes an `unlock` option that strips `<sheetProtection>` from every worksheet
  and `<workbookProtection>` from the workbook. Because we *write* the file rather than ask Excel to unlock it, the
  password is irrelevant. `lockStructure` goes too — without it the cells are editable but sheets still cannot be
  added, renamed or unhidden.
  - Applied **last**, after the printable sheet has been rewritten, so nothing re-introduces it.
  - Gated in the route: `isAdmin(user) || userHasWorkflowRole(…, "payment_approver")`. **Production still gets the
    locked form**, which is the point of the protection — the printed sheet shouldn't be edited on the floor.
- **Verified against the real templates**, 9 checks: for Panel Fan, Power Roof and Centrifugal Blower the unlocked
  copy has **no** sheet protection and **no** workbook protection, and the production copy's protection state is
  unchanged.
- **Checked the file isn't quietly corrupted** — the risk with hand-edited XML. Reopened through ExcelJS: same two
  sheets, `Source` still hidden, and **312 non-empty cells on both copies**. Identical in structure and content.
- Typecheck + lint + build clean. No migration.

## 2026-08-27 · Autofill: the product type decides the job order, not its category

- **Owner-confirmed pairing.** *Tubeaxial / Vaneaxial* is the **TAF / VAF** template; *Centrifugal Inline Blower* is
  **CIEB**. That is exactly what the old code got wrong.
- **The bug.** `fanJoType` searched `type + " " + category` as **one string**, so a category could outvote the
  product inside it. A **Tubeaxial** or **Vaneaxial** filed under *Tubular Inline Type* matched `"inline"` before
  `"axial"` and came out as a **Centrifugal Inline Blower** — a CIEB sheet issued for a TAF.
- **Fix: precedence, not more keywords.** `joTypeFromText` classifies one string; `fanJoType` asks the **type**
  first and only consults the **category** when the type says nothing (which is what "Customized Jet Fan" under
  *Axial Type* relies on). `axial` is also tested before `inline` so a Tubeaxial keeps its own template wherever
  both words appear.
- **Verified by diffing the mapping before and after** across all 25 fan lines: **exactly two rows changed** —
  Tubular Inline Type → Tubeaxial and → Vaneaxial. Everything else, EWF/FAWF and PRV/PRVDD included, is
  byte-identical. All 25 are now correct.
- **Still open — the JO's `Project` field.** `fanProjectCode` matches the model code against `FAN_PROJECT_CODES`,
  which is *only* the Centrifugal Blower list (`CFABCAB, CABSISW, CEBCAB, CFAB, CEB, CAB`). It was never extended
  when the other five templates arrived, so every non-centrifugal job order gets a **blank** Project.
  - The valid codes already exist, per template, in `src/components/fans-job-order-form.tsx` — taken from each
    template's own data validations: Inline `CIEB`; Panel `EWF, FAWF`; Power Roof `PRV`; Axial
    `TAF, VAF, TAFDD, VAFDD`; DIDW `DIDWCEB, DIDWCFAB, CEBCAB, CFABCAB`.
  - So the fix is to pick the code from **the chosen template's own list**, longest-first, rather than from one
    hardcoded centrifugal list. Not a one-liner: those lists live in a component and would need to move somewhere
    both it and the lib can read. Left for owner approval.
- Typecheck + lint + build clean. No migration.

## 2026-08-27 · Autofill: propeller wall fans get the Panel Fan job order

- **Reported (owner).** On order **2026 - AFBM00002821S** the quotation sells an **Exhaust Wall Fan** (Propeller
  Type / Belt, 48"Ø, model `AV4800EWF3K3F3T`), but *Auto-fill job orders from quotation* produced a
  **Centrifugal Blower** job order.
- **Cause.** `fanJoType` picks a template by searching for keywords in `type + category` —
  `didw → inline → panel → roof → axial` — and falls back to `centrifugal_blower`. There was **no keyword for a
  propeller or wall fan at all**, so those lines dropped to the fallback. Power Roof Ventilator only ever escaped
  because "roof" happens to be in its own name.
- **Swept the whole taxonomy through the real function** rather than reading it — every fan type it offers, with
  both drives. Three mappings were wrong; the reported one was not alone:
  | Category | Type | Was | Should be |
  |---|---|---|---|
  | Propeller Type | Exhaust Wall Fan | Centrifugal Blower | **Panel Fan** |
  | Propeller Type | Fresh Air Wall Fan | Centrifugal Blower | **Panel Fan** |
  | Tubular Inline Type | Tubeaxial / Vaneaxial | Centrifugal Inline Blower | Tubeaxial / Vaneaxial |
- **Fixed the first two, owner-approved** (Phase 2 is frozen; the owner confirmed in-conversation that
  **EWF / EWFDD and FAF / FAFDD all use Panel Fan** and need no template of their own). A propeller in a wall panel
  is a panel fan, and it is the only one of the six templates that fits a 48" propeller.
  - Matched on the **type**, not the category. "Propeller Type" also holds **Power Roof Ventilator**, which must keep
    falling through to Power Roof — so the category must not be the trigger.
  - Bought-in goods are unaffected: `isFan` already excludes the whole `Other Products` category, so
    "Wall Mounted Fan" there never reaches this function.
- **Verified by diffing the mapping before and after** across 25 lines: **exactly four rows changed** — EWF and FAF,
  belt and direct — and every other row, PRV/PRVDD included, is byte-identical.
- **Left alone, unapproved and still open:**
  - **Tubular Inline Type → Tubeaxial / Vaneaxial** still yields Centrifugal Inline Blower. Different flavour of the
    same bug: `"inline"` is tested before `"axial"` *and* the category is folded in with the type, so the category
    "Tubular Inline Type" beats the product type "Tubeaxial".
  - The job order's **Project** field comes out blank for these. `FAN_PROJECT_CODES` lists only centrifugal codes
    (`CFABCAB, CABSISW, CEBCAB, CFAB, CEB, CAB`); `EWF`, `PRV`, `TAF`, `VAF`, `HPB` are all missing despite having
    catalogues of their own.
- Typecheck + lint + build clean. No migration.

## 2026-08-26 · Hero propeller redrawn from the owner's reference photo

- **Request (owner).** A photograph of a five-blade aircraft propeller: *copy this and make it rotate.*
- **What was copied.** Matte black **paddle** blades — a narrow shank that stays slim well past halfway, then flares
  into a broad squared tip with rounded corners — **twin white tip bands**, a **copper maker's decal** at 58% span
  with a small painted index mark below it, and a **polished hub** carrying a retention collar per blade, an
  eight-bolt circle and a centre boss. The shroud, dashed throat ring and mounting bosses of the previous artwork are
  gone; the reference is a bare propeller.
- **The backlight is from the photo and it is load-bearing.** Five near-black blades on a near-black hero would
  vanish. The photo's cool halo behind the hub solves that without inventing anything — and it sits **outside** the
  rotating group, because a lamp behind a propeller does not spin with it.
- **Proportion was the thing that needed measuring, not eyeballing.** A first pass used a hub radius of 27 against a
  tip radius of 86 — 31% of the diameter, which made the hub the subject and the blades an afterthought. The
  reference hub is ~22%; it is now **20** (23%). The blades were re-cut narrower at the same time.
- **Sweep is still 0.00°** — root centre and tip centre both land on x = 100.000, measured off the rendered path.
  The reference blades *look* raked; that is twist and camera angle, not plan-form sweep.
- **AFBM lettered across the blades (owner).** A bold white letter just inboard of the tip bands — **A, F, B, M** on
  blades 1–4. Four letters across five blades, so the **fifth carries none**; that is the request, not an oversight.
  - Each letter sits inside its own blade's rotated group, so it turns with the blade and goes upside down at the
    bottom of the sweep — which is what painted lettering does on a real propeller.
  - The decal and index mark shifted 2 units inboard to make room.
- **Markings are painted on, not floated over.** They live in a `clipPath` of the blade in blade-local space, so one
  definition serves all five, the letters included, and nothing can spill past an edge.
  - Checked in the browser rather than assumed: the font resolves to real **Manrope 800** (not a silent fallback),
    the fill is `rgb(255,255,255)`, and the glyph box spans x 96.2–103.8 against a blade half-width of ~9.9 at that
    radius — comfortably inside the paint.
- **Rotation reversed (owner).** Now **anticlockwise**. Tailwind's `spin` keyframe only counts up to 360°, so the
  direction is set with `reverse` on the animation shorthand rather than by adding a second keyframe.
- **Verified in a browser**, not by reading the markup:
  - Direction measured off the rotor's **live transform matrix**, unwrapped across the ±180° seam: six samples fall
    −63.4° → −110.6°, a net **−47.1°** over ~0.9 s. Negative is anticlockwise, and −47° in 0.9 s confirms the 7 s
    period is untouched.
  - Frames one second apart differ in **7.3%** of the fan's area (it turns), and under
    `prefers-reduced-motion: reduce` two frames differ in **0 px** — so `motion-reduce:animate-none` still beats the
    longer shorthand.
- The preview page's "Highlight what rotates" control was replaced with **"Show one blade"** — with no shroud left,
  almost everything rotates, so the old toggle had nothing to say; isolating one blade lets the plan-form be held
  against the photo.
- Typecheck + lint + build clean. No migration, no workflow change.

## 2026-08-26 · The hero artwork is a rotating five-blade propeller

- **Request (owner).** Make the hero's abstract rotor a rotating **5-blade propeller fan**.
- **New `store/hero-fan.tsx`** — SVG, so it stays crisp at any size and costs no image request. One blade is drawn at
  12 o'clock and the other four are the same path rotated by 72°.
- **Sweep 0°, then a banana blade at the same 0° (owner).** The first cut raked the blade. Owner asked for no
  sweep, then for a **banana** — a crescent — keeping the sweep.
- **Those two only look like they fight.** A blade that curves to one side normally carries its tip round with it,
  which *is* rake. They coexist because **sweep lives in the two end chords, not the curve between them**: root
  (94,75)–(106,75) and tip (94,28)–(106,28) are both square to the radial and centred on x = 100, so the tip sits
  directly above the root. The bow in between is **camber** — a different quantity, and free.
- **A wrong turn worth recording.** Trying to force the ends' *tangents* parallel to the radial as well produced an
  S, not a banana: a curve that leaves straight, bows, and arrives straight. Six candidate blades were rendered side
  by side and every one looked like a worm. A single cubic per edge, with the chords doing the work, is correct.
- **Measured off the rendered path, not asserted** — 6,000 samples:
  | | |
  |---|---|
  | root centre | x = **99.999** |
  | tip centre | x = **100.001** |
  | **sweep** | **0.00°** |
  | camber (the banana) | 21.8 units of bow |
  | radius span | 19.0 – 78.0 (hub 24, throat 82) |
- **One real bug the measurement caught**: the root cap's arc flag bulged it *into* the blade instead of down into
  the hub. It read as 2.4° of phantom sweep until the flag was flipped — a defect no amount of looking at the
  spinning fan would have surfaced.
- **Only the rotor turns.** Blades and hub sit in a `<g>` that spins on a 7-second linear loop; the shroud, its
  dashed throat ring and the four mounting bosses stay put. That is what makes it read as *a fan running* rather than
  the whole assembly being spun.
- **Geometry is bounded by the housing.** Blade root at radius 26 (under the hub, so the join never shows), tip at
  **78** — inside the shroud's 82 throat. The first attempt used a fatter blade reaching past 90: it read as five
  flower petals and the tips cut straight across the shroud. Caught on the first screenshot and re-cut.
- **Respects `prefers-reduced-motion`.** Both the spin and the gentle float now stop. The float is pre-existing and
  had **never** honoured the setting — worth fixing while the file was open, since a permanently drifting hero is
  exactly what that preference exists to switch off.
- **Verified in a browser**, not by reading the markup:
  - Two frames one second apart differ in **16.8 %** of the fan's area — it genuinely turns. Zero would have meant a
    static picture.
  - The frame diff shows change confined to the blades and hub; the shroud ring and bosses register only the float's
    drift, confirming they don't rotate with the rotor.
  - Under `prefers-reduced-motion: reduce` two frames a second apart differ in **0 px** — it holds completely still.
- Unchanged: the artwork is still only the fallback. Set a Hero photo in Admin → Storefront and it replaces this.
- Typecheck + lint + build clean. No migration, no workflow change.

## 2026-08-26 · Text colours are settable on the storefront

- **Request (owner).** Add an option to change the website's text colours. The Look card had five colour pickers and
  every one of them was a **ground or accent** — nothing controlled type.
- **Four fields, not one.** The shop alternates light sections and dark ones (hero, footer, category tiles), and each
  carries full-strength type plus a quieter tier for captions and breadcrumbs. So: **Text**, **Text — muted**,
  **Text on dark**, **Text on dark — muted**. Defaults are the approved design's own values, so an untouched shop is
  unchanged.
- **Button labels are deliberately excluded.** Every remaining `text-white` sits on `bg-[var(--store-accent)]` or
  `bg-[var(--store-ink)]` — a label belongs to its button, not to the page. Setting "Text on dark" to cream recolours
  the hero headline and the footer and leaves *Get a Quote* white on red, which is the only sane behaviour.
- **`--store-steel` was already the muted token** — 42 classes point at it — but it was **pinned in the layout**.
  It now reads from the theme, so those 42 came along for free. Five near-identical hardcoded greys
  (`#536275`, `#526173`, `#6e7d8b`, `#788795`, `#8a96a5`) were folded into it, and nine on-dark greys into the
  on-dark muted token.
- **Two bugs the sweep exposed.**
  - A bulk replace put the product page's `/` and `·` separators — which sit on **white** — into the *on-dark*
    bucket, where the default is a pale grey. They would have been near-invisible. Caught on screenshot; reverted to
    their own neutral, since decorative punctuation isn't type the owner wants to steer.
  - The hero eyebrow was `#e5ebf2`, essentially white, and the first pass demoted it to the *muted* tier — visibly
    dimming the most prominent label on the page. It belongs to full-strength **Text on dark**.
- **Verified against a real storefront** (13 seeded products, throwaway Postgres, Playwright), by pixel-diffing the
  page before and after the change:
  | | differing pixels |
  |---|---|
  | hero, after fixing the eyebrow | 0.25 % |
  | footer | 0.58 % |
  What remains is **one deliberate flattening**: the design carried a dimmer on-dark grey in three places (footer
  prose `#9ba8b8`, hero metric labels `#8998aa`, the hero caption card `#8795a7`) which now share the single muted
  token at `#b9c4d2`. Slightly brighter, better contrast, and inspected side by side before keeping it. Say the word
  and it gets its own tier back.
- Then re-tinted to a deliberately alien palette (green / olive / cream / gold) to prove each field reaches what it
  claims: light headings, light body, dark-section headings and dark-section captions each moved independently, the
  accent stayed red, and the buttons stayed white.
- The editor's live Preview now paints itself in the chosen text colours instead of hardcoded whites.
- Typecheck + lint + build clean. No migration, no workflow change.

## 2026-08-26 · Attach a file for the storefront Logo and Hero photo

- **Request (owner).** Add a file-attach option to the **Logo** and **Hero photo path** fields in
  Admin → Storefront → Look, instead of typing a path.
- **The hint was describing a workaround.** "Upload via a product photo, then paste its path" was literally the only
  way it worked: `/api/store-image` serves a `store/…` object **only if it is a photo of a listed product**
  (`isPublicStorePhoto`) — a deliberate guard so the endpoint can't be used to read the storage bucket. So an image
  uploaded as branding belonged to no product and **404'd for shoppers**; the sole route in was to smuggle it in as
  some listed item's photo.
- **The allowlist now knows about branding.** `publicPhotoPaths` also admits the theme's own `logoUrl` /
  `heroImagePath` when they are `store/…` uploads. Still an allowlist, not an open proxy — only those two exact
  paths, and clearing a field revokes it. Saving the theme drops the cached set, so a just-attached image doesn't
  spend a minute 404ing (which the image route asks browsers to cache, making the wait feel longer than it is).
- **New `ImageField` in the editor** — thumbnail, the path (still hand-editable), **Attach file**, and **Clear**.
  Attaching POSTs to the existing admin `/api/store-uploads` and writes the returned path back into the field.
  Oversized files are caught client-side at 4 MB, because the serverless body cap rejects them with nothing worth
  showing an admin. The thumbnail previews through the **admin** route, which needs no product listed — so a fresh
  upload shows at once and a bad path is obvious here rather than on the live shop.
  - It does **not** reuse the shared `Field`: that renders a `<label>`, and a file picker is itself a `<label>`.
    Nested labels are invalid and make it unpredictable which control a click lands on. Caught on screenshot.
- **Hero accepts what the logo accepts.** It was hardcoded to wrap the value in `/api/store-image?path=`, so a
  public file or a full URL pasted into it silently broke. Both fields now resolve through `themeImageSrc`.
- **Verified.** 9 checks against a real database on the allowlist: logo and hero reachable once attached, an
  unrelated `store/…` path **not** reachable, a path outside `store/` **not** reachable, traversal **not**
  reachable, a public-path logo adding nothing to the allowlist, and clearing a field revoking access. The control
  itself was rendered in a browser and screenshotted.
  - **Not verified end to end:** the upload itself needs Supabase Storage, which no local environment has. The route
    it posts to is the one product photos already use unchanged.
- Typecheck + lint + build clean. No migration, no workflow change.

## 2026-08-26 · MRF prefill matched against the REAL products / inventory catalogue

- **Correction (owner).** On the deployed form every row still came back **unmatched** — "Induction Motor (TECO)"
  in Articles / Description, the whole specification stranded in Remarks. Owner: match the quotation's lines to
  `products.xlsx` / `inventory.xlsx` so **every** row autofills.
- **Root cause: the matcher had never seen the real catalogue.** It was built against a plausible one. The real
  `products.xlsx` (1,014 products, in the repo) names motors like
  `INDUCTION MOTOR 1 HP , 3PH 0.75 KW, 4 POLE, FOOT MOUNTED (TECO)` — and stocks the **same rating twice**, once
  TECO and once HYUNDAI. Three separate things were breaking:
  - `.75KW` tokenised as **75 kW** (the regex ignored a leading dot), so correct products were hard-rejected.
  - `1/2"` split into `1` and `2`, making `5/16"Ø x 1/2"` and `5/16"Ø x 1 1/2"` indistinguishable.
  - Ranking on *matched token count* let a long name win on incidental hits — `PULLEY 3"Ø x 2B BIG HUB` resolved to
    `PULLEY 9 1/2"Ø x 3B x ATLEAST 1/2 MM HUB…`, whose repeated `1/2` scored twice over.
- **Rewritten around what actually distinguishes these products.**
  - **Dimension safety (hard reject).** HP, kW, **phase** and **pole** are each read as the number before the unit
    ("Three Phase" → 3). A product stating a figure the line contradicts is out, whatever it scores — a 1 HP
    *single-phase* motor can never fill a 1 HP *three-phase* line. Silence on a dimension is never a rejection.
  - **Brand safety (hard reject).** Brands are learned from the catalogue — a parenthesised word more than one
    product carries — which finds TECO, HYUNDAI, IDEC. A line naming TECO can no longer be filled with the HYUNDAI
    equivalent, which it otherwise **would have been**: the HYUNDAI name shares more words.
  - **Fit (the ranking).** Harmonic mean of how much of the product name the line accounts for and how much of the
    line the product accounts for, over **distinct** tokens. Both halves are load-bearing: one alone lets long names
    swallow short ones, the other lets a bare `INDUCTION MOTOR` beat the 15 HP three-phase one being described.
  - **It still refuses to guess.** If close-scoring products differ on a dimension the line never states, nothing in
    the quotation picked the winner — its name was merely shorter. That resolves to *unmatched* and the requestor
    chooses. A bare "Induction Motor" with no rating matches nothing, by design.
- **Verified against the real 1,014-product catalogue, not a sample.** Every product name fed back as a quotation
  line:

  | | |
  |---|---|
  | resolved to **itself** | **1,006** |
  | ambiguous → unmatched (safe) | 8 |
  | resolved to a **different** product | **0** |

  The 8 are genuine collisions the tokeniser cannot separate (`1/2"Ø x 1"` vs `1/2"Ø x 1 1/2"`, `5"Ø x 6C` vs
  `6"Ø x 5C`) and fail safe.
- **3236J now fills completely** — five quotation lines → four rows, still 9 units, every one a real product:
  `15 HP`, `1.5 HP` ×2 (separate rows, different remarks), `1 HP` ×4 — all TECO, all 3PH, unit `pc` from the
  catalogue. Each row's Remark still carries that line's own specification for the warehouse.
- Catalogue is tokenised **once** per prefill rather than per line. 13 checks + the full round trip, all passing.
  Typecheck + lint + build clean.

## 2026-08-26 · Office MRF prefills from the WON QUOTATION's line items
- **Correction (owner).** The first pass sourced the prefill from `orderBoughtInLines`, which **combines identical
  products** — right for a PO, wrong here. On **3236J** that collapsed five separate motor lines into one
  `9 unit · Induction Motor (TECO)` row and threw away every rating. Owner: wire the MRF to the won quotation's own
  line items.
- **Split the combining out.** New `orderBoughtInLinesRaw` returns **one entry per quotation line** (name, qty,
  the verbatim description, and the spec values as text); `orderBoughtInLines` is now that plus the existing combine
  step, so **Phase 4 and the PO are byte-for-byte unchanged**. The MRF reads the raw lines.
- **Matching rewritten to use everything the quotation knows.** A catalogue product is a candidate when **every token
  of its name** appears in the line's text (label + description + specs); the most specific candidate wins; a tie is
  genuine ambiguity and resolves to *unmatched*. Tokenising keeps decimals whole — **"1.5" never matches "15"**, which
  is exactly what separates a 1.5 HP motor from a 15 HP one.
- **Verified against all five real 3236J lines** and a catalogue holding 1 / 1.5 / 3 / 15 HP:
  | # | qty | resolves to | from |
  |---|---|---|---|
  | 1 | 1 | INDUCTION MOTOR **15 HP** | "15 Hp, 11 Kw, Three Phase" |
  | 2 | 2 | INDUCTION MOTOR **1.5 HP** | specs — its description never says HP |
  | 3 | 2 | INDUCTION MOTOR **1.5 HP** | "1.5 Hp, 1.1 Kw" — *not* 15 HP |
  | 4 | 2 | INDUCTION MOTOR **1 HP** | "1 Hp, 0.75 Kw" — *not* 1.5 |
  | 5 | 2 | INDUCTION MOTOR **1 HP** | same |
  Total still 9 units, and each row's Remark carries that line's own specification for the warehouse.
- **Identical rows merge (owner).** Two quotation lines that produce the same row — same product, same unit, **same
  remark** — collapse into one with the quantities summed. On 3236J that turns the two 1 HP lines (2 + 2) into a
  single row of 4: **five quotation lines → four MRF rows, still 9 units.**
  - Identity deliberately includes the remark. Items 2 and 3 both resolve to *INDUCTION MOTOR 1.5 HP* but the
    quotation describes them differently ("TEFC, 1.5 Hp, 1.1 Kw" vs "220V, 4 Pole, 90L Frame, TECO Brand") — merging
    those would throw one description away, and the warehouse needs both to know what it's picking. They stay separate.
- 19 checks, all passing — incl. a line with two equally-specific fits left unmatched, an unrelated product not
  matched, an empty catalogue keeping the quotation's wording, identical *unmatched* rows merging on the same rule,
  first-appearance order preserved, and a zero+zero pair staying blank rather than becoming "0".
- Typecheck + lint + build clean.

## 2026-08-26 · Office MRF prefills from the order's own items
- **Request (owner).** On **3236J**, autofill the Office Material Request Form from the order itself, so the requestor
  reviews and presses **Submit request** rather than retyping.
- **The constraint that shapes this.** Articles / Description is **selection-only** (#420): a row whose text isn't an
  exact catalogue product name is rejected and blocks submission. So a prefill is only useful if it resolves to a real
  product — filling in text that looks right and then refuses to submit would be worse than an empty form.
- **New `lib/mrf-suggest.ts`.** Turns the order's bought-in lines into MRF rows, resolved against the catalogue:
  exact name → name with any "(…)" qualifier dropped → containment, **but only when containment finds exactly one
  candidate**. Qty comes from the order; unit from the matched product; the quotation's specification goes in the
  **Remark**, which is free text — the warehouse needs "Foot Mounted · 80 kg" to pick the right item off the shelf,
  and it can't live in the description without breaking the selection-only rule.
- **It deliberately refuses to guess.** 3236J's line reads *Induction Motor (TECO)*. Against a catalogue holding
  several ratings that's **ambiguous**, and silently picking one would put the wrong motor on a real material request.
  Ambiguous lines keep the order's wording, are counted in a red hint, and the existing selection-only check blocks
  submit until the requestor picks the exact item. Resolving it is their call, not a heuristic's.
- **Form behaviour.** Rows seed on mount when Office is the first raisable department (the bought-in case, where it's
  the only one), and on switching to Office **only while the form is untouched** — it can never overwrite typing. A
  **Fill from order** button re-applies it on demand. A line above the table says where the rows came from.
- **8 matcher checks, all passing**: the 3236J line resolving against a single-motor catalogue; the same line left
  unmatched against three ratings; exact name beating containment; qualifier-dropped match; empty catalogue; catalogue
  unit used; zero qty leaving the box blank rather than "0"; and no false positive on an unrelated product.
- Typecheck + lint + build clean.

## 2026-08-26 · Office can raise an MRF in the order workflow
- **Request (owner).** Let **Office** raise a Material Request inside the order workflow, "while still maintaining the
  workflow settings". Owner chose the requestors — **Purchaser, Sales, Engineer, Payment Approver, Admin** — and the
  window: **any time the order is live**.
- **Frozen-area note.** Phase 3 is locked and this *does* change who can act, so it was confirmed in-conversation
  before any edit. Nothing about the existing production gating moved (tests below).
- **Why Office couldn't before.** An MRF's department was typed `ProductionDeptKey`, and `raiseMaterialRequest`
  validated against the four production lines. Office is deliberately *not* a production department: no job order, no
  single head role. Three separate gates blocked it — the dept whitelist, `deptRole()`, and the
  `wf.jobOrders[dept]` + `in_production` requirement.
- **What changed.**
  - `MaterialRequest.dept` widens to `MrfDeptKey` (the four lines **plus** Office).
  - **Office branch in the raise**: gated by the five roles above; skips the job-order requirement; window is
    `released → closed` instead of `in_production → production_finished`. **The production branch is untouched** —
    same roles, same job-order check, same production window.
  - Requestor-side actions (cancel, follow up, confirm receipt) route through one `isMrfRequestorFor` gate.
  - Phase 3 card opens for whoever may raise an Office MRF, and stays visible once an order has any MRF on it —
    a bought-in order reaches neither `in_production` nor a job order, so otherwise an Office MRF could never be seen.
- **One definition of "who is Office".** `isOfficeMrfRequestor` lives in `lib/order-workflow` and takes primitives, so
  the server gate and the My Dashboard feed share it. Two copies of that role list would drift the moment either was
  edited. Sales / Engineer are ACCOUNT roles; Purchaser / Payment Approver stay **workflow roles assigned in
  Admin → Workflow roles**, so who holds them remains a setting — that's the "maintain the workflow settings" part.
- **Bug the compiler caught, worth calling out:** the workflow JSON coercion filtered material requests through the
  *production* dept set. Left alone it would have **silently dropped every Office MRF on the next read**, losing it
  from the order entirely. Widening the type surfaced this and 18 other call sites that assumed a production line.
- **Already correct, verified not broken:** `stockLocationPolicy("office")` lets Office issue from Office *or* Plant
  stock, and `recordDeptStockTransfer` deliberately excludes Office from `VALID_TO_DEPTS` (booking a Fans→Office move
  would double-credit Fans, since the resale already credits it).
- **24 gate checks, all passing**: each of the five Office roles admitted; Warehouse, Logistics, Plant Manager, a
  production head and a plain user all denied; and every production case unchanged — own head yes, another line's head
  no, Sales no, Purchaser no, admin yes.
- Typecheck + lint + build clean.

## 2026-08-26 · Phase 4 spec — extended to every order, and to the PO the supplier gets
- **Report (owner).** Order **3236J** had the same short description as 3032S; asked to check every affected order.
- **Answer: it isn't a per-order data problem.** The generator never carried the spec until today, so **every**
  bought-in requisition ever raised holds only the product name. There's no list to hunt — one systemic cause.
- **So the fix derives the spec on READ, not on write.** New helper `withSpecDetail(items, specs)` folds the
  quotation's specification into the stored lines whenever a purchase request is loaded. Every existing order is
  covered at once, with no data migration and no stored row touched.
- **Two gaps closed vs the first pass** (which only decorated the Phase 4 card):
  1. **The Purchasing workspace** — where the Purchaser actually builds the PO — showed the bare name, so a PO
     prepared there would still have gone to the supplier without the mounting or rated capacity. It now enriches
     once at load, so the cards, the combine picker **and the PO's default lines** all see the same full description.
  2. **The trailing `· @<price>` marker** is anchored to the end of the line, so appending the spec after it would
     have stranded the supplier grid price and stopped the PO auto-filling. The spec is spliced in *before* it.
- **Also hardened:** `specDetailFor` now picks the **longest** matching product name. With "Spring Vibration Isolator"
  and "Spring Vibration Isolator Heavy Duty" on one order, first-match would have given the heavy-duty line the plain
  product's rated capacity.
- **What the fix can't reach:** a PO **already prepared and saved** keeps its own stored line text — rewriting a
  document already sent to a supplier isn't something to do silently. `docs/sql/boughtin-spec-affected-orders.sql` lists exactly
  those requisitions so the Purchaser can re-apply the default lines on each.
- **12 end-to-end checks, all passing**: old line with and without a price, the PO's qty/unit/price/description after
  enrichment, no double-up on a new line, the `to purchase` and `issued from stock` prefixes, unrelated items, empty
  spec lists, longest-name-wins both ways, and the text preview.
- Typecheck + lint + build clean.

## 2026-08-26 · Phase 4 shows the quotation's full specification (display + PO text)
- **Request (owner).** Phase 4 showed only *"6 unit · Accessories Spring Vibration Isolator"* while the quotation maker
  held the full detail (*Foot Mounted*, *Rated capacity 80 kg*). Wire the quotation through so Phase 4 shows what the
  quotation says — checked against order **2026 - AFBM00003032S**.
- **Frozen-area note.** Phase 4 is locked; the owner requested this specific change in-conversation. It is also
  **display + document text only** — no change to who acts, the step order, the gating or the stage progression.
- **Where the detail was lost.** `autoRaiseBoughtInRequisition` built each requisition line from `orderBoughtInLines`,
  which returns only the supplier-facing **name** (`productLabel`). The quotation's multi-line `descriptionSnapshot`
  never left the quotation — so the requisition, the Phase 4 card **and the PO** all had a bare product name. A
  supplier can't ship the right isolator from "Spring Vibration Isolator" alone; it needs the mounting and the rated
  capacity, which is the part that actually mattered here.
- **Fix, in two halves.**
  1. **New requisitions carry the spec.** `orderBoughtInLines` now also returns `detail[]` — the quotation's
     description lines minus anything the name already says (new `productDetailLines`). The generated line becomes
     `6 unit · Accessories Spring Vibration Isolator · Foot Mounted · Rated capacity 80 kg`, kept on **one** line
     because every downstream parser of that string is line-oriented. This flows to the Phase 4 card, the Purchasing
     workspace **and the PO**, whose unit price still auto-fills.
  2. **Existing requisitions are filled in at render.** Order 3032S was raised before this, so its stored line has no
     spec — the order page now hands the quotation's bought-in lines to `PurchasingChain`, which shows any spec line
     the stored item doesn't already contain (`specDetailFor`). No re-raising needed, and a new line that carries its
     own spec never doubles up.
- **De-duplication of combined lines fixed too.** Identical products were merged on `name` alone; the key now includes
  the spec, so two isolators differing only in rated capacity stay on separate lines instead of silently merging.
- **Verified with the real strings from the screenshots:**
  - `productDetailLines` → `["Foot Mounted","Rated capacity 80 kg"]`; 6 cases incl. the WDRV line whose size/material
    is already folded into the name (correctly yields no duplicate detail).
  - `specDetailFor` → fills the old line, returns nothing for the new one, and still matches through the `@price` and
    `To purchase:` prefixes; 6 cases, 0 failures.
  - `poLineFromPRItem` on the longer line → qty `6`, unit `unit`, price `1779.68`, description carrying all three
    parts — the extra `·` separators don't disturb the qty/unit split or the trailing price marker.
- Typecheck + lint + build clean.

## 2026-08-26 · Fan Selector — the visitor picks which model gets quoted
- **Request (owner).** Make the selection results **selectable**, and have **Quote this selection** carry the model the
  visitor picked into the quotation dialog's *Product / Application* field.
- **Selection.** Every result row is now a radio choice: a real `<input type="radio">` in a new first column (so
  keyboard and screen readers work) plus a click target on the whole row. The picked row gets an accent tint and a red
  left bar. A run **starts on the engine's recommendation** — the common case needs no click — and the visitor can move
  off it. Re-running resets the pick to the new recommendation.
- **What reaches Sales.** `Quote this selection` now sends the *picked* row, not the recommended one, and the subject
  line was rewritten to lead with the model code and read the way an engineer quotes:
  `AV4025CEB — 20,000 CFM @ 2.00 in w.g. (555 rpm, 15 HP)` — previously `Fan selection: … 498 Pa`, which buried the
  model behind a prefix and used Pa. The footer bar states which model is about to be quoted so there's no ambiguity
  before the dialog opens, and the button disables when nothing is picked.
- The no-match branch reuses the same helper, so an enquiry with no standard model still carries the duty point.
- The dialog's Product field is narrower than the value; the full string is submitted regardless, and a `title` makes
  it readable on hover.
- **Verified end to end**: picking the last row then quoting put `AV5450CEB — … (787 rpm, 25 HP)` in the field;
  re-picking a different row and re-opening put `AV4450CEB — … (1180 rpm, 40 HP)` — the field tracks the pick.
- Typecheck + lint + build clean.

## 2026-08-26 · Public HVAC Tools page on the storefront
- **Request (owner).** Add **HVAC Tools** to the shop nav between *Why Aerovent* and *Main Website ↗*; clicking it opens
  a page with **Fan Selector, Ductulator, Pulley and Fan Law**, in the storefront's own theme.
- **What's public and what isn't.** The four requested tools only. **Duct Material** (a sheet-metal costing aid) and
  **Job Order** (a production document) stay staff-only — both are internal, and one of them prices metal.
- **Fan Selector runs the real engine, price-free.** It posts to **`/api/public/fan-select`**, the read-only CORS-open
  route built for exactly this page: same selection engine as the staff quotation builder, but the response whitelists
  performance fields only — no price, no body cost, no internal catalogue id. Verified by rendering the page with
  results on screen and asserting the HTML contains **no `₱` anywhere**. The product dropdown is filled from that
  route's own GET discovery endpoint, so a new family reaches the shop with no storefront deploy.
- **One source of truth for the maths.** The other three calculators had their physics inline in the ERP components.
  Extracted to **`lib/hvac/{ductulator,pulley,fan-law,parse}.ts`** (pure functions, no React); the staff tools now call
  those, and the storefront renders the same functions with its own skin. A fix to a formula now reaches both.
  - **Proved the extraction changed nothing**: re-implemented the original inline formulas from git history and diffed
    them against the libs over a sweep of every mode / unit / shape combination — **1016 comparisons, 0 mismatches**.
- **Nav placement that survives a saved theme.** `toolsNavLabel` is its own theme field (default "HVAC Tools", empty
  hides it) rather than a `navLinks` entry — a shop whose nav was saved before this page existed would never have
  contained it. The layout splices it in just before the first external link, so it lands between *Why Aerovent* and
  *Main Website ↗* and stays sensible if the nav is reordered. Also in the footer's Support column and the mobile menu.
- **SEO.** Own title/description/canonical, `BreadcrumbList` + `WebApplication` JSON-LD (free, four named tools), in the
  sitemap, and described in `/llms.txt` — including an explicit note that the selector returns performance only and
  cost questions go to the quotation form.
- **Bug caught by rendering, not by the compiler:** `TOOL_KEYS` was exported from a `"use client"` module and imported
  by the server page. Typecheck and build both passed, but at request time every export of a client module is a client
  *reference*, so `TOOL_KEYS.includes(...)` threw and the page 500'd. Moved the constants to a plain `tools.ts`.
- **Verified end to end**: nav order reads *Shop | Categories | Custom Solutions | Why Aerovent | HVAC Tools | Main
  Website ↗*; selector returns ranked models with a Recommended badge; ductulator 2000 cfm @ 0.1 in.wg/100ft → 18.1″ Ø,
  1123 fpm; pulley 1750 rpm / 4″ / 8″ → 875 rpm, 0.5:1, 1833 fpm; fan law 1000→1200 rpm → 1.2×, 6,000 cfm;
  `?tool=pulley` deep-links; mobile stacks.
- Typecheck + lint + build clean.

## 2026-08-26 · Storefront rebuilt to the approved prototype (payments untouched)
- **Request (owner).** Rebuild `/store` to the **exact appearance and functionality** of the supplied HTML prototype,
  while keeping the HitPay / PayPal payment work already in place.
- **What the prototype is.** Dark engineering hero with an animated rotor stage, condensed uppercase headings
  (**Barlow Condensed**) over **Manrope** body, a red `#E5202B` accent, a four-up trust band, dark category tiles with
  an active red gradient, a searchable/sortable four-column catalogue, a split made-to-order band, an
  article + FAQ block, a dark four-column footer, plus a **cart drawer**, a **quotation dialog** and a **toast**.
- **Built it for real, not as a mock.** The prototype's hard-coded product array is replaced by the live catalogue:
  the server renders **every listed product** into the markup (so crawlers and answer engines still see the whole
  shop) and the new `catalogue-browser.tsx` does category / search / sort **client-side and instantly**.
  - The prototype's demo quote form now posts to the existing public **`/api/rfq`** intake — honeypot and all — so an
    enquiry lands in the same Inbound RFQ queue Sales already works. A product card's "Request quote" prefills the
    product; the dialog links to `/rfq` when drawings need attaching.
  - The cart drawer is server-priced on every change (`priceCartAction`) and its "Proceed to checkout" goes to the
    real `/store/checkout`. **Nothing in the payment path changed** — `placeOrder`, `/api/store/pay`, the HitPay HMAC
    webhook and the PayPal return are byte-for-byte the same; only button shapes on the order page were restyled.
- **Still fully customizable.** `lib/store-theme.ts` grew from 16 fields to ~35 — top bar, logo, nav links, hero
  eyebrow / two-line headline / both CTAs / metrics, the four trust panels, every section's kicker+heading+blurb,
  the made-to-order bullets, the article body, the FAQ, and contact details — all in the same `AppSetting` row
  (**no migration**), all editable in **Admin → Storefront**, all with the prototype's copy as the default. A new
  `safeHref()` keeps a hand-edited link from injecting `javascript:` into the page.
- **SEO / AI SEO kept and extended.** Same JSON-LD, sitemap, robots and `/llms.txt` as before, **plus** the FAQ is now
  published as `FAQPage` structured data and repeated in `llms.txt` — the block an answer engine quotes verbatim.
- **Two bugs caught by actually rendering it** (throwaway Postgres + seeded catalogue + Playwright, not by eye):
  1. Tailwind arbitrary values can't contain bare spaces — `w-[min(1240px,calc(100%-28px))]` is invalid CSS and was
     dropped, so **every section rendered full-bleed** with no gutter. Needs `calc(100%_-_28px)`.
  2. `src/lib` was **not in Tailwind's `content` globs**, so the shared `WRAP` / `DISPLAY` / `KICKER` constants
     generated **no CSS at all** — the markup shipped class names that didn't exist. Added the glob (with a comment
     saying why), which is the general fix for any class string living in `lib/`.
- **Verified end to end** against a seeded 13-product catalogue: live search (4 hits for "curtain"), price sort both
  ways, category filter, quote-dialog prefill, add-to-cart → drawer → checkout carrying the right server-priced total,
  the product page, category page and mobile layout.
- Typecheck + lint + build clean.

## 2026-08-26 · Products import — a multi-supplier row keeps its price (and prices are editable)
- **Bug (owner).** The Products tab showed supplier chips with an empty price placeholder, so the Purchasing tab's
  **Unit Price** never auto-filled — even though `products.xlsx` carries a **Lowest price** column for the row.
- **Root cause — the importer, not the display.** `products.xlsx` packs every supplier for a product into ONE
  `Suppliers` cell (`"TRADE ONE INC.; POWERLINK MERCHANDISE TRADING CORP."`) and puts the figure in the separate
  **Lowest price** column. `parseSupplierCell` only applied that row price when the cell named **exactly one**
  supplier (`parts.length === 1 && rowPrice`). Of the 1015 rows in the file, **410 name two or more suppliers with no
  embedded `₱`** — every one of them imported with **no price at all**, i.e. ~40% of the catalogue was priceless. The
  screenshot's INDUCTION MOTOR 1.5 HP (3 suppliers, Lowest price 21015) was one of them.
- **Fix.** The row-price fallback now applies **regardless of supplier count**. An embedded `₱1,234` in the cell still
  wins per supplier; otherwise every supplier on the row takes the row's price. Approximate for the dearer supplier,
  but a visible, correctable figure beats a blank that blocks PO autofill entirely.
- **Editable in place.** Because a multi-supplier import now gives each supplier the same figure, the product editor's
  supplier chips carry an **inline unit-price input** — correct one supplier without removing and re-adding it. Blank
  clears the price.
- **Purchasing needs no change.** `purchasing/page.tsx` already builds `catalogPrices` from `product.suppliers[].price`
  and a `REF_PRICE_KEY` = lowest supplier price (else the stock item's unit cost), which `withCatalogPrices` /
  `catalogPriceFor` use to fill a PO line's Unit Price (#419). It was starved of data, not broken — **re-import
  `products.xlsx` and the prices appear**.
- **Verified** against all 7 real cell shapes in the file (single/multi, with and without `₱`, thousands separators,
  `&`/apostrophe in names, no-price rows). One data-quality caveat surfaced: a row whose Lowest price is `1` with a
  `₱3130` supplier gives the two unpriced suppliers **₱1** — bad source data, now visible and editable.
- Typecheck + lint + build clean.

## 2026-08-25 · Storefront redesign — premium look, customizable theme, SEO + AI SEO, performance
- **Request (owner).** The first storefront was "simple and not appealing". Wanted a **stunning, premium, elegant**
  shop that is **SEO + AISEO**, **fast loading**, **easy to use**, and **customizable to fit the vibe**.
- **Customizable (the architectural part).** New `lib/store-theme.ts` + **Admin → Storefront**: accent / hover / dark
  ground colours, corner style, product-image fit, announcement bar, hero headline / subhead / CTA / background,
  the three value-prop panels, and all SEO + AI copy. Stored in an `AppSetting` row (**no migration**), emitted as CSS
  custom properties (`--store-accent` …) so Tailwind classes follow it. Saving revalidates `/store` — restyle the shop
  with no deploy. Includes a live hero preview and "Reset to defaults".
- **Design.** Self-hosted **Manrope + Inter** via `next/font` (no runtime request, no layout shift). Sticky blurred
  header with search + category nav + mobile slide-over; dark hero with accent wash and dot-grid; value-prop band;
  category chips; elevated product cards (fixed 4:3 frame, hover lift, stock/made-to-order badges); premium PDP with
  thumbnail gallery, **sticky buy box**, trust rows, spec table and related products; redesigned cart / checkout /
  order pages; rich 4-column footer.
- **SEO.** Per-page `generateMetadata` with canonicals + OpenGraph/Twitter; `sitemap.ts` (home, categories, every
  listed product); `robots.ts` allowing the shop while disallowing the whole signed-in ERP, `/q/` links and
  cart/checkout/order; JSON-LD via `lib/store-seo.ts` — Organization, WebSite + **SearchAction**, Store, **Product with
  Offer/AggregateOffer + availability**, BreadcrumbList, ItemList. Quote-only items deliberately publish **no price**.
- **AI SEO.** New **`/llms.txt`** — a live Markdown brief for answer engines: what the business is, how buying works,
  key pages, and the current catalogue with prices/stock, plus explicit notes ("direct fabricated enquiries to the
  quote form, never quote a price"). Generated from the same catalogue, so an assistant can't state a stale figure.
- **Performance.** `isPublicStorePhoto` was a **DB scan per image request** (the hottest path) → 60s in-process cache;
  image redirects now carry `max-age=600, s-maxage=1800, stale-while-revalidate`. Fixed aspect ratios everywhere (no
  CLS), first grid row eager + `fetchPriority=high`, rest lazy. Store home ships **1.4 kB** of page JS.
- **Bug caught in review:** `/robots.txt`, `/sitemap.xml` and `/llms.txt` were **not** in `PUBLIC_PATHS`, so middleware
  would have redirected every crawler to the login page — silently defeating the entire SEO effort. Added.
- Typecheck + lint + build clean.

## 2026-08-25 · Store — a listed product can be sold whatever its family (price decides, not family)
- **Bug (owner).** Listed the Östberg CK inline duct fans, saved slug/photo/description ("Saved."), but `/store` still
  said *"No products are listed yet."*
- **Root cause.** Östberg CK is family `TUBULAR_INLINE`, which is in `FABRICATED_FAN_FAMILIES` → `isQuoteOnly()` true →
  the admin row rendered the **"Quote-only" badge INSTEAD of the Listed/Draft toggle**, and the edit panel **hid the
  Listed checkbox**. So "Save Listing" stored the cosmetic fields but `storeListed` stayed `false` and the storefront
  (which only reads listed items) showed nothing. There was **no way at all** to put a fabricated-family item on the
  store.
- **The real conflict.** `family` describes the *type* of fan; `isQuoteOnly` was using it to mean *"we fabricate this"*.
  An **Östberg / KDK** inline fan is a TUBULAR_INLINE by type but a **bought-in resale product** commercially — so
  family cannot decide sellability. Only ACCESSORY / SERVICE / OTHER were sellable, blocking every branded fan resold.
- **Change (owner chose: admin decides per item).**
  - Admin: the **Listed/Draft toggle now shows for every product**; the Quote-only badge is kept as *information* (with
    a tooltip) beside it, and the edit panel's "Visible on storefront" checkbox is always available. The variant count
    and both prices are now shown for every family — the price is what decides a cart, so it has to be visible.
  - Storefront: `quoteOnly` is now **"has no catalogue price"**, not "is a fabricated family". A listed item with a
    price gets a cart; without one it shows quote-on-request. Listing stays an explicit admin action, so nothing
    reaches the store by accident.
  - New `StoreProduct.fabricated` (from `isQuoteOnly(family)`) drives WORDING only: an unpriced fabricated fan still
    reads *"Made to order — quoted by specification"*, while any other unpriced item reads *"Price on request"*.
- Typecheck + lint + build clean.

## 2026-08-25 · Unification Phase B5 — stock gate, ERP handoff & order emails
- **Request (owner).** Two decisions taken: a paid order becomes a **counter sale with stock issued by hand** (not
  auto-deducted), and the store **blocks out-of-stock items** rather than accepting the order anyway.
- **Gap this closes.** Before B5 the storefront sold with **no stock check at all** (you could buy what we don't have),
  a paid order sat at `PAID` invisible to the ERP, and **nobody was notified** an order had arrived.
- **Change.**
  - `lib/store-stock.ts` — joins a store product to inventory on the shared **Item Code** (`modelCode` ↔ `sku`, the
    same standard the MRF matcher uses), falling back to exact name. Multi-location rows are **summed**, with the
    fullest row as the issue point. An untracked item is `null` = **sellable** (a drop-shipped resale item mustn't be
    blocked by a missing ledger row); only a *tracked* item at 0 is out of stock.
  - Storefront: `StoreProduct.available` + `inStock()`. Cards and the product page show **Out of stock** (with an
    "Enquire" link to `/rfq`), a low-stock note under 5, and the qty box is capped at what's on hand.
  - `priceCart()` enforces it **server-side** (the gate that matters): an out-of-stock line is dropped, and a line
    asking for more than we hold is **trimmed to what's there** with a reason shown, rather than silently failing.
  - `lib/store-erp.ts` — `handOffStoreOrderToErp`: a PAID order becomes a **DRAFT counter sale**, so a web sale is the
    same record type as a walk-in and flows into sales reports / P&L. **Deliberately DRAFT** — completing a counter sale
    is what issues stock, and that stays a human step, so an oversold or mis-matched line is caught before inventory
    moves. Lines carry `stockItemId` where matched. Customer resolved **by email** (repeat buyers accumulate on one
    client record). Idempotent, with an in-transaction re-check so racing webhooks can't double-create.
    `soldById` uses an `"online-store"` sentinel — it has no FK and gates only "who may discard this draft", so a web
    order's draft is admin-only to discard.
  - `lib/store-notify.ts` — buyer receipt + a new-order alert to Accounting / Logistics / Admins (with a direct link to
    the draft counter sale). Best-effort by design.
  - Both hooked into `markStoreOrderPaid`, and **only on the call that actually flipped the row**, so a duplicate
    webhook can't re-send emails or re-create the sale. Both are wrapped so a failure **never** un-pays a paid order —
    it's logged and the order stays PAID for a human.
- **Verified:** `next build` clean; typecheck + lint clean.

## 2026-08-25 · Unification Phase B4 — storefront payment (HitPay + PayPal)
- **Request (owner).** Online payment via **HitPay** and **PayPal**. Migration `0046` confirmed applied (both tables
  RLS-on).
- **Change.** Hand-rolled fetch clients in the house style (no SDK dependency, like `resend.ts` / `semaphore.ts`);
  contracts verified from published SDK source since gateway docs are egress-blocked.
  - `lib/payments/hitpay.ts` — create / read a payment request (form-encoded, `X-BUSINESS-API-KEY`), and
    `verifyHitpayHmac` (drop `hmac`, sort keys, concat `k+v`, HMAC-SHA256 with the API **salt**, **constant-time**
    compare).
  - `lib/payments/paypal.ts` — Orders v2: OAuth token → create order (intent CAPTURE, `approve` link) → capture.
    An already-captured order (422 `ORDER_ALREADY_CAPTURED`) falls back to reading the order, so a double return is
    harmless.
  - `lib/store-payment.ts` — `markStoreOrderPaid`, the single settle path: **idempotent** (repeat webhooks / reloads),
    **amount-verified** to the centavo against the order row, currency-checked, and applied with a conditional
    `updateMany` on `PENDING_PAYMENT` so two concurrent webhooks can't both settle. A short payment is never accepted —
    it's logged and left pending for a human.
  - Routes `api/store/pay` (browser sends only the order number — the **amount comes from the order row**),
    `api/store/hitpay-webhook` (rejects anything failing HMAC), `api/store/paypal-return` (captures against **our**
    stored `providerRef`, not the query string, so a crafted URL can't attach someone else's payment).
  - Order page gains pay buttons + paid / failed / cancelled states; options only appear for a configured provider.
  - `middleware.ts` — `/api/store/` public (buyers have no session; gateways call server-to-server).
- **Verified:** HMAC unit-tested — genuine callback passes; tampered amount, wrong salt, missing and short `hmac` all
  rejected; key order irrelevant. `next build` registers every route; typecheck + lint clean.
- **Owner action:** set `HITPAY_API_KEY`, `HITPAY_API_SALT`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` (+ optional
  `HITPAY_ENV` / `PAYPAL_ENV`, default **sandbox**) in Vercel. Until then the buttons stay hidden and the order page
  says payment isn't switched on. Point the HitPay webhook at `{appUrl}/api/store/hitpay-webhook`.
- **Next:** B5 — paid order → ERP counter sale + stock deduction.

## 2026-08-25 · Unification Phase B2/B3 — cart, checkout & the store-order model
- **Providers chosen (owner): HitPay + PayPal.** Verified both are integrable from this environment: gateway *docs*
  are egress-blocked (403), but **npm is reachable**, so HitPay's contract was read from a published client's source
  — `POST {base}/payment-requests` (form-encoded, headers `X-BUSINESS-API-KEY` + `X-Requested-With`), base
  `https://api.sandbox.hit-pay.com/v1` / `https://api.hit-pay.com/v1`, response carries the hosted-checkout `url`, and
  the **webhook HMAC** is sorted-key `k+v` concatenation HMAC-SHA256'd with the API salt. PayPal has an official SDK
  (`@paypal/paypal-server-sdk`). Payment itself lands in B4.
- **Change.**
  - **Schema + migration `0046_store_orders`** — `StoreOrder` / `StoreOrderItem` + `StoreOrderStatus`
    (PENDING_PAYMENT / PAID / CANCELLED / FULFILLED). Item rows **snapshot** model code, name and website price, so a
    later catalogue price change never rewrites a placed order. `provider` / `providerRef` / `paidAt` are ready for
    B4; `counterSaleId` for the B5 ERP handoff. Ends with the mandatory enable-RLS block.
  - `lib/store-cart.ts` — the browser stores **only slug + variant + qty**; `priceCart()` re-reads the catalogue and
    recomputes every line server-side, so a tampered or stale cart can't buy at the wrong price. Unlisted / quote-only
    / unpriced lines are dropped with a reason shown to the shopper.
  - `store/cart-store.ts` — localStorage cart over `useSyncExternalStore` (header badge, product page and cart page
    stay in step, including across tabs). `add-to-cart.tsx`, `cart-link.tsx`.
  - Routes `/store/cart`, `/store/checkout`, `/store/order/[orderNumber]` (confirmation, reachable by order number).
  - `store/actions.ts` — `priceCartAction` + `placeOrder`. Public actions, so both re-derive prices server-side;
    `placeOrder` validates the buyer fields and claims a `WEB-#####` number in a transaction.
- **Verified:** `next build` registers every store route; typecheck + lint clean.
- **Next:** B4 payment (HitPay + PayPal + webhooks), B5 paid order → ERP counter sale + stock.
- **Owner action:** apply migration `0046` in Supabase (the build does not run `migrate deploy`).

## 2026-08-25 · Unification Phase B1 — the public storefront (catalogue, categories, product pages)
- **Request (owner).** Proceed with unification + website creation; scope chosen: **full e-commerce** (cart + online
  payment). B1 is the storefront foundation every later slice builds on.
- **Change (all new, nothing existing touched except one middleware line).**
  - `lib/store-catalog.ts` — storefront reads of the SAME `CatalogueItem` records the ERP uses, filtered to
    `storeListed`: slug (explicit or derived), category label + slug, photos, priced **variants** and the DERIVED
    website price (AeroQuote ÷ 0.95). `isQuoteOnly` families carry **no price and no cart**. Also
    `isPublicStorePhoto()` — the gate below.
  - Routes: `/store` (all listed products + category chips), `/store/c/[category]`, `/store/p/[slug]` (photos,
    variants, description; quote-only items route to `/rfq` instead of a price). Shared `layout.tsx` shell +
    `product-card.tsx`, in AeroVent red `#ED1C24`.
  - `api/store-image` — **public** product photo. Deliberately not an open bucket proxy: the path must be under
    `store/` AND be a photo of a **listed** item, so drafts and every other object stay unreachable. The admin
    `api/store-uploads` (upload + draft preview) stays admin-only.
  - `middleware.ts` — `/store` + `/api/store-image` added to `PUBLIC_PATHS` (shoppers aren't signed in).
- **Verified:** `next build` registers all four routes; typecheck + lint clean. (The sandbox build's `/reset-password`
  prerender error is pre-existing — that page needs Supabase env vars, absent here; the build passes once they're set.)
- **Next:** B2 cart + checkout, B3 order model, B4 payment gateway (needs the provider decision — this environment's
  egress blocks gateway docs, so the plan is to read a provider SDK's types from npm, which IS reachable), B5 ERP
  handoff of a paid order.

## 2026-08-25 · Follow-up email — "unlimited" per run stopped at ~25 (same timeout class as the SMS fix)
- **Bug (owner).** **Max emails per run = 0 (unlimited)** but Resend's history shows only ~25 sent per run. Same root
  cause as the SMS fix (#417), which only batched the SMS pass: the **email** pass still sent **one at a time**
  (Resend call + a quote stamp + a registry write each), so the 60s cron function was killed after ~25 — and because
  `lastRunAt` had already been stamped, the rest waited a whole day.
- **Change.**
  - `email/resend.ts` — `sendEmail` retries **429 / 5xx** with a short capped backoff (honours `Retry-After`), so
    concurrent sends survive Resend's per-second rate limit instead of losing the message.
  - `follow-up-runner.ts` — shared `runBatched(items, size, deadline, fn)` helper; the **quote-follow-up**,
    **inquiry check-in** and **SMS** passes now all evaluate first, then send in bounded concurrent batches
    (email 4, SMS 8) under a **45s send budget** (the 60s function ceiling minus headroom), so a run always stops
    cleanly and reports what happened rather than being killed mid-write. Per-run cap semantics unchanged — the cap
    counts what a run *attempts*, and email + inquiry check-ins still share one budget.
  - New `FollowUpRunResult.deferred` — messages that were due and **within** the cap but not attempted because the
    time budget ran out. `api/cron/follow-ups` **skips stamping `lastRunAt` when `deferred > 0`**, so the next hourly
    tick drains the backlog instead of waiting for the next scheduled slot. **Cap throttling never defers**, so a
    domain-warm-up cap (e.g. 24/run) still sends exactly once per scheduled run.
- Typecheck + lint clean. (Resend's batch endpoint would be faster still, but resend.com is blocked from this
  environment so its contract couldn't be verified — this uses only behaviour already exercised in production.)

## 2026-08-25 · Purchasing — bulk delete on the Rejected / Cancelled tabs · FROZEN Phase 4 (owner-approved)
- **Request (owner).** Add a bulk-delete option to the **Rejected** and **Cancelled** purchasing tabs (42 + 5 rows to
  clear one at a time otherwise).
- **Change.**
  - New server action `deletePurchaseRequests(ids)` (`orders/actions.ts`) — **admin only**. Each id is expanded through
    its combined-PO members (as the single delete does), then the set is **re-checked against the DB and filtered to
    `REJECTED` / `CANCELLED`** — a live request can never be deleted even if a stale page sends its id. Returns
    `{ deleted, skipped }`.
  - `purchasing-chain.tsx` — new `allowClosedSelection` prop: closed rows' tick boxes (normally disabled) are re-enabled
    so they can be selected for deletion. `COMPLETED` stays locked.
  - `purchasing-workspace.tsx` — on the Rejected / Cancelled tabs (admin) a bulk bar appears: **Select all / Clear**,
    "N of M selected", and a destructive **Delete selected (N)** with a confirm. Covers order material requests,
    department requisitions and replenishments; the dept/replen chains only switch to the shared (controlled) selection
    on those tabs, so every other tab behaves exactly as before.
  - Known scope: rejected/cancelled **combined-PO cards** keep their existing per-card delete (their tick box lives in
    `CombinedPurchasing`, outside the shared selection).
- Typecheck + lint clean.

## 2026-08-25 · Requisition / MRF — Articles / Description is selection-only · FROZEN Phase 3 (owner-approved)
- **Request (owner).** Users must not be able to free-type into the **Articles / Description** box on the department
  requisition and the Phase 3 Material Request Form — they may type to *search*, but can only **select** an existing
  product.
- **Change.** New shared `components/product-picker.tsx` (`<ProductPicker>`): typing filters the menu, but a value is
  committed **only by picking a match** (click / Enter). On blur an empty box clears the row, an exact product name
  commits, and anything else **snaps back** to the last pick — free text can never be submitted. Keyboard nav
  (↑/↓/Enter/Esc), SKU search, fixed-position menu (table scroll never clips it), and a "no match — add it in Products
  first" hint.
  - `requisitions/requisition-form.tsx` — replaces the `<input list=…>` + `<datalist>`; picking also fills a blank unit.
  - **Frozen Phase 3:** `orders/[id]/material-requests.tsx` — its local `ProductCombobox` (free-text) replaced by the
    shared picker. UI input-validation only: no change to who acts, step order, gating or stage progression.
  - **Escape hatch:** with an empty product catalogue the field stays plain free text (otherwise the forms would be
    unusable before the first import) — mirroring the existing "unknown item" validation, which is likewise only
    enforced when a catalogue exists. The unknown-item guard is kept as a server-side-of-the-form safety net.
- Typecheck + lint clean.

## 2026-08-25 · PO creation — autofill from products / suppliers / inventory data
- **Request (owner).** When the PO line's product is known: one supplier → autofill everything; 2+ suppliers → the
  dropdown shows only those; picking a supplier autofills Company / Attention / Address / EWT / Payment terms
  (suppliers.xlsx); unit price from the supplier price / **Lowest price** (products.xlsx) and **Unit cost**
  (inventory.xlsx).
- **Root cause.** The autofill machinery (carrier filter, single-supplier auto-pick, `pickSupplier`, catalogue prices)
  already existed but was **starved of data**: products.xlsx packs suppliers as one cell — `"NAME ₱price; NAME ₱price"`
  — and the importer took the whole cell as ONE company name → junk "₱-priced" suppliers, no per-supplier price links.
- **Change.**
  - `products/actions.ts` — `parseSupplierCell`: splits on ";", strips a trailing `₱/PHP amount` into the link's
    price (falls back to the row's price column for a single-supplier cell). Merge now drops stale junk-named links
    (`isPricedSupplierName`) and lets the file's price refresh an existing link.
  - `lib/po-catalog.ts` — `REF_PRICE_KEY` pseudo-company inside CatalogPrices: the item's reference price (lowest
    supplier price, else inventory unit cost). `catalogReferencePriceFor` + new `fallbackPriceFor` +
    `withCatalogPrices` use it to fill blank unit prices when the chosen supplier has no saved price (typed prices
    never overwritten).
  - `purchasing/page.tsx` — builds the reference prices server-side (lowest supplier price → stock `unitCost`;
    inventory-only items included), no prop changes needed.
  - `combined-purchasing.tsx` `pickSupplier` — now also autofills **Payment terms** from the supplier's saved remark
    (the order-page panel already did).
- **Owner action:** re-import `products.xlsx` (the parser now handles the raw export), then Admin → Suppliers →
  **Remove invalid (N)** to purge the old junk entries.
- Typecheck + lint clean; parser unit-tested against the real cell formats.

## 2026-08-25 · Public quotation view — AeroVent red branding
- **Request (owner).** The shared client quotation page (`/q/[id]`) rendered in the app's blue theme — change it to
  **AeroVent's standard red**.
- **Change.** Company name, header underline and items-table header now use the brand red `#ED1C24` (the same hex used
  across the JO panels / purchasing chain / approver alarm), table header text white. UI-only.

## 2026-08-25 · Follow-up SMS — full 100-per-run cap actually sends (timeout fix)
- **Bug (owner).** "Max texts per run" is 100 but Semaphore shows **<25 messages per run**. Root cause: the hourly cron
  route (`api/cron/follow-ups`) never set `maxDuration`, so it ran on Vercel's **default ~10s timeout** — and the runner
  sent texts **one at a time** (Semaphore call + a DB stamp each). The function was killed mid-loop after ~20 sends;
  per-quote stamps survive, so each hourly retry sent another small batch.
- **Change.**
  - `api/cron/follow-ups`: `maxDuration = 60` (matches the app's other heavy routes).
  - `follow-up-runner.ts` SMS pass split into **evaluate-then-send**: Phase 1 queues everyone due (cap applied, same
    skip/preview items); Phase 2 sends in **parallel batches of 8** — 100 texts now finish in ~15–20s instead of
    ~2 minutes. Each task still stamps its own quote right after its send, so a crash mid-run never repeats a nudge.
  - Semantics note: cap slots are now claimed at queue time (a failed send consumes its slot for that run).
- Typecheck + lint clean.

## 2026-08-25 · Collection Receipt read — capture the EWT row for the Sales Summary
- **Request (owner).** Also read the **EWT withheld** row of the CR's settlement box (e.g. ₱100.00, the gross-minus-net
  difference) — it autofills the **EWT FP** column of the Sales Summary (Vatable).
- **Change.**
  - `saleDocReadSchema.ewtAmount` + `SaleDocReadStamp.ewtAmount`; the read prompt now extracts the tax-withheld row
    (sanity check: gross − EWT = net cash; null when no withholding is shown, never guessed).
  - The net-of-EWT tally fallback now also accepts the EWT **as read off the receipt** (in addition to the order's
    recorded EWT payment lines).
  - `buildSalesSummary` EWT FP now prefers the EWT read off the CR (cleared read first), falling back to the recorded
    EWT payment lines. `approveSaleDoc` preserves the field.
- Typecheck + lint clean.

## 2026-08-25 · Collection Receipt read — tally the GROSS settlement amount (not net cash)
- **Request (owner, practice reading).** On a Collection Receipt the amount that must tally with the Sales Invoice is
  the **gross settlement amount** in the left "IN SETTLEMENT OF THE FOLLOWING" box (e.g. ₱11,200.00) — the "( PHP )" /
  bottom TOTAL is often the **net cash** after EWT withheld (₱11,100.00 = 11,200 − 100 EWT) and was being flagged as a
  false mismatch.
- **Change (`api/ai/read-sale-doc`).**
  - Prompt: a Collection Receipt's `amount` is the gross settlement amount from the settlement box, never the net cash;
    if both appear and differ, return the gross and note the net in warnings.
  - Server-side safety net: if the read amount is short of the order total by exactly the order's recorded **EWT
    withheld**, it still tallies (`amountMatches` true, with an explanatory note) — covers receipts that only print the
    net cash figure.
- Typecheck + lint clean.

## 2026-08-24 · Sales Summary (Vatable) — Excel / PDF / Email exports (match WON report)
- **Request (owner).** Give the Sales Summary the same export row as the WON Sales Report — add **Excel**, **PDF** and
  **Email** beside **View** / **Print**.
- **Change.**
  - New export routes `reports/sales-summary/xlsx` and `reports/sales-summary/pdf`, plus `emailSalesSummary` in
    `reports/sales-summary/actions.ts` (PDF attached), all built off `buildSalesSummary` so the four surfaces stay in
    sync. New `lib/pdf/sales-summary-pdf.tsx` (landscape, all 9 columns).
  - `summary-controls.tsx` now mirrors the WON panel's control row: From / To → **View · Print · Excel · PDF · Email**,
    with the same collapsible email box (disabled + amber note when email isn't configured). `page.tsx` passes
    `emailReady`.
- Typecheck + lint clean.

## 2026-08-24 · Sales Summary (Vatable) — TIN autofilled from the closing documents
- **Request (owner).** The report's TIN should **autofill from the TIN read on the Sales Invoice / Collection Receipt /
  Delivery Receipt**, not only the hand-entered client TIN.
- **Change.**
  - The closing-doc AI reader now also captures the **buyer's TIN** (`saleDocReadSchema.customerTin`; a new
    `customerTin` on `SaleDocReadStamp`). The prompt is explicit: read the sold-to / customer TIN, NOT the seller's
    pre-printed TIN in the letterhead.
  - On a successful read the client's registry TIN is **autofilled (fill-if-empty)** so the profile shows it, without
    ever overwriting a TIN entered by hand.
  - `buildSalesSummary` now prefers the TIN read off this order's documents (Sales Invoice → Collection Receipt →
    Delivery Receipt, a cleared read first), falling back to the saved client TIN.
- Typecheck + lint clean.

## 2026-08-24 · Sales Summary (Vatable) report + dashboard tiles
- **Request (owner).** A **Sales Summary (Vatable)** tile on **Accounting My Dashboard** and the **Admin Production
  Dashboard** (right side, in the row with Unreconciled Vouchers). Clicking it opens a register in a **new sheet** with
  columns **Date · SI Number · CR · DR · Company · TIN Number · P.O. Amount · EWT FP · Company Address** — same
  view/print/from-to behaviour as the WON Sales Report, **dated by Payment date**.
- **Change.**
  - New `lib/sales-summary.ts` — `buildSalesSummary(from, to)`: one row per **confirmed VATABLE** order (sale confirmed
    and `vatModeChargesOutputVat`), booked on the sale's **payment / recognition date**. SI / CR / DR numbers come from
    the AI reads captured on each closing doc (`classification.saleDocReads`); PO Amount = `payableTotal`, EWT FP =
    `ewtWithheld`; company + address from the customer.
  - New route `reports/sales-summary` — a print-friendly register mirroring the WON report page, with an inline From/To
    picker (`summary-controls.tsx`) and Print (payment-date basis is fixed).
  - **Client TIN** — the `Customer` table has no TIN column, so (like `terms` / marketing flags) it rides in the account
    registry: `AccountData.tin` (`lib/account.ts`), an editable **TIN** field on the client profile
    (`customer-header.tsx` + `updateCustomer`), read into the report.
  - **Tile** added to `my-dashboard/page.tsx` `ordersGrid` (after Unreconciled Vouchers), gated for Admin / Accounting /
    Payment Approver, opening the register in a new tab.
- Typecheck + lint clean.

## 2026-08-24 · Closing docs — role-based AI read / approve (SI / OR / DR) · FROZEN Phase 5
- **Request (owner).** Accounting must always **AI-read** the Sales Invoice / Collection Receipt (OR) / Delivery
  Receipt, with the **3-read limit** — on error show the message, on success notify success; after 3 errors **lock +
  escalate**. **Admin / Payment Approver** upload → AI reads → they can **approve** the upload (override) and **allow
  more** reads. Applies to **both** the Sale & payment panel and the order's Phase 5 closing-docs.
- **Change.**
  - New shared client `quotations/[id]/sale-doc-reader.tsx` — per closing-doc slot: **auto-reads** a freshly uploaded
    file, shows ✓ success / ✗ error inline, tracks the per-order 3-read limit, and for Admin / Payment Approver renders
    **Approve upload** (accept regardless of the AI result) and **Allow 3 more reads**.
  - `lib/sale.ts` — `SaleDocReadStamp.approved` + `isSaleDocCleared`. Server actions `approveSaleDoc` /
    `resetSaleDocReadLimit` (Admin / Payment Approver only) in `quotations/actions.ts`.
  - `sale-panel.tsx` (non-frozen) now renders `<SaleDocReader>` per SI/OR/DR slot (replaces the inline #405 read UI).
  - **Frozen Phase 5:** `close-documents.tsx` + `fulfillment-actions.tsx` thread the reader context (reads / count /
    unlimited / order amount / currency) so the same reader appears on the order's closing-documents step. Owner-approved.
- Typecheck + lint clean.

## 2026-08-24 · Suppliers — one-click purge of "priced" junk suppliers
- **Bug (owner).** After the raw `products.xlsx` (export shape) was imported, its `Suppliers` cell values
  (`RITE PRODUCTS INC. ₱8078.02`, `A ₱1; B ₱2`) became **supplier company names** — so a PO offered a priced duplicate
  supplier and the directory filled with ~1 junk entry per product row.
- **Change (`admin/suppliers`, not frozen).** New admin action `removeInvalidSuppliersAction` + a **"Remove invalid (N)"**
  button on the Suppliers page. It deletes every supplier whose name contains a peso sign or semicolon (a real name never
  does) from **both** the directory and every product's supplier links, so POs stop offering the priced duplicate.
  Helper `isPricedSupplierName` / `removeInvalidSuppliers` in `lib/suppliers.ts`. Typecheck + lint clean.

## 2026-08-24 · Inventory import — reuse a cleared item; migration 0045 must be applied
- **Bug (owner).** Inventory bulk import failed rows with `Unique constraint failed on the fields: (sku)`. Two causes:
  1. **Migration `0045_stock_multi_location` was never applied to the DB.** The Vercel build runs `prisma generate &&
     next build` only — migrations are applied by hand (`npx prisma migrate deploy` / Supabase SQL, per README). So the
     DB still has the single-column `sku` unique index; the client expects `(sku, location)`. Same-code rows fail. **The
     owner must run the `0045` SQL in Supabase.**
  2. Like products, "Clear all" only deactivates stock items (they keep the unique code), and the importer matched only
     ACTIVE items by name+location → it tried to create, hitting the code's unique constraint.
- **Change (`inventory/actions.ts`, not frozen).** The importer now matches an existing item by name + location
  **including inactive** (prefers active), and **reactivates** it — and when the file gives a location but the only
  existing row is unassigned (no location), it **adopts** that row and sets the location, instead of creating a clashing
  new one. Re-importing reuses rows instead of failing/duplicating. Typecheck + lint clean.
- **Action still required:** apply migration `0045` to the database for the two-location items to save.
- **Follow-up (after 0045 applied).** With the composite key live, updates then failed with
  `Unique constraint failed on the fields: (sku, location)` — the importer matched an item by name+location but a
  leftover duplicate row (from earlier failed imports) already owned that `(sku, location)`. Fixed: the importer now
  picks the row that **already owns `(sku, location)` first** (updating it is a no-op on those fields, so it can't
  collide), then falls back to same-name-at-location, then adopt-unassigned. Re-importing no longer collides; leftover
  same-name duplicates can be cleaned with the location-aware merge tool.

## 2026-08-24 · Products import — reuse a cleared product by its code (no duplicates)
- **Bug (owner).** Re-importing the product list first failed every row ("could not be imported"), then — after the
  diagnostic below — created a **duplicate** of every product. Root cause: **"Clear all" only deactivates**
  (`active:false`) products, which keep their unique Item Code; the import matched existing products by *active* name
  only, so it never found the deactivated ones, and their code was already taken.
- **Change (`products/actions.ts`, not frozen).**
  - Import now matches an existing product by the file's **Item Code first (regardless of active state)**, else by
    active name — and **reactivates** it on import. Re-importing (even after a Clear all) reuses the same product and
    its code instead of creating a duplicate. The create path only runs for a genuinely new item, and a file code is
    only auto-generated when blank (an owned code always matches above, so no unique-constraint failure).
  - The per-row catch now appends the actual error detail, so any real failure is diagnosable instead of a blanket
    "could not be imported".
- Typecheck + lint clean.

## 2026-08-24 · Multi-location stock — Phase 2 (issue-from-stock location routing) · FROZEN Phase 3/4
- **Request (owner, explicit).** When issuing materials from stock: **Fans & Blower / Duct / Accessories** deduct from
  the **Plant Warehouse**; **Motor Controller / Office** may **choose** Plant or Office (**default Office**). Owner
  confirmed the location names (Plant Warehouse / Office), to include requisitions (the Office path), and the Office
  default. This modifies the frozen Phase 3 (MRF) / Phase 4 (requisition) stock pickers — approved in-conversation.
- **Design.** The issue/release actions already deduct from a `stockItemId` the picker supplies, so the routing is done
  by **which location row the picker selects**, backed by a server guard. New shared lib `src/lib/stock-location.ts`:
  `stockLocationPolicy(dept)` (plant-only vs choose), `pickIssueRow(rows, dept, chosen)` (used by client + server so
  they agree), and `isLocationAllowedForDept` (server guard). Single-location items are unaffected (one row → picked
  for every dept).
- **Change.**
  - Stock lists now carry `location`: `orders/[id]/page.tsx`, `lib/inventory.ts` `listStockItemsWithAvailability`, and
    the `StockOpt` types. Each MRF/requisition passes its **dept** to the pickers (`ReqRow.dept`,
    `PurchaseChainRow.dept`).
  - Pickers route by dept: `mrf-stock-check.tsx` + `requisition-stock-check.tsx` (per-line issue, with a Plant/Office
    select for choose-depts, default Office), `mrf-triage-panel.tsx` (bulk process) and `stock-match-panel.tsx` (release)
    default the match to the policy location and label each option with its location.
  - Server guards (defense-in-depth) in `orders/actions.ts`: `issueMrfLineFromStock` / `issueRequisitionLineFromStock`
    reject a plant-only dept pointed at Office stock; `processMaterialRequest` treats a disallowed-location pick as 0
    available → routes it to purchasing. (The purchased-materials release path is not guarded — it releases whatever was
    received into stock.)
- **Not changed:** order-level "release from stock" keeps its behaviour (no requesting dept → prefers Plant). No schema
  change (Phase 1 already added multi-location). Typecheck + lint clean; the only failing test is the pre-existing,
  unrelated `selection.test.ts`.

## 2026-08-24 · Multi-location stock — Phase 1 (same SKU in more than one location)
- **Request (owner).** Track the same item / SKU in more than one location (e.g. Plant Warehouse + Office). Owner chose
  **Phase 1 only** (non-frozen): allow the same SKU per location, fix the importer so a second-location row is added
  rather than merged, and leave the **frozen Phase 3 / MRF** stock-deduction untouched (to be approved separately).
- **Change (model + inventory import/CRUD only; no MRF / Phase 3 code touched).**
  - `prisma/schema.prisma` — `StockItem`: `sku` / `barcode` are no longer unique on their own; uniqueness is now the
    pair **`@@unique([sku, location])`** and **`@@unique([barcode, location])`**. Migration `0045_stock_multi_location`
    drops `StockItem_sku_key` / `StockItem_barcode_key` and creates the composite indexes (existing one-per-SKU rows
    satisfy them unchanged; Postgres keeps NULLs distinct).
  - Importer (`inventory/actions.ts`) matches an existing item by **name + location** (falls back to name-only when a
    row has no location), so the same item in a different location becomes its **own row** instead of overwriting the
    first. SKU / barcode clash checks now reject only a *different-named* item (import) or the same code *at the same
    location* (create / edit).
  - Duplicate detection + `mergeDuplicateStockItems` now key on **name + location**, so an item stocked in two
    locations is not flagged / merged as an accidental duplicate.
  - Aggregate stock value already sums across all rows, so it stays correct with per-location rows.
- **Not done (deferred, needs owner approval):** location-aware MRF/requisition deduction (which location to issue
  from). The frozen MRF still matches whichever stock row it finds by name/SKU. Typecheck + lint clean.

## 2026-08-24 · Closing documents — AI read + verify + capture doc number (Sales Invoice / Collection Receipt / Delivery Receipt)
- **Request (owner).** Enable AI reading on the **Sales Invoice**, **Collection Receipt** and **Delivery Receipt** of a
  **VAT-inclusive / zero-rated** sale — read the document, **verify** its amount against the order total, and **capture
  its serial number** so the same document can't be re-used on another order. **Admin / Payment Approver override** the
  3-read limit.
- **Change (additive; no Phase 5 workflow logic touched).**
  - New reader route `src/app/api/ai/read-sale-doc/route.ts` — reads the document, extracts the **serial number**, **date**
    and **total**, checks the amount against the order total (advisory), and scans other quotes for the same number on a
    same-kind document (**duplicate guard**). Persists a `SaleDocReadStamp` per file on `classification.saleDocReads`
    (sibling of `sale`, so it survives `recordSale`) plus a per-order `saleDocReadCount`. Capped at
    `AI_SALE_DOC_READ_LIMIT = 3`; **Admin / Payment Approver are unlimited** and their reads don't consume the budget.
  - `src/lib/sale.ts` — `AI_READABLE_SALE_DOC_KEYS`, `SaleDocReadStamp`, `saleDocReadsFromClassification`,
    `normalizeDocNumber`. `src/lib/ai/schemas.ts` — `saleDocReadSchema`. `src/lib/ai/limits.ts` — the new limit.
  - `sale-panel.tsx` — a **"read"** button (ScanLine) beside each Sales Invoice / Collection Receipt / Delivery Receipt
    file, with an inline ✓/⚠ status (captured No., amount-vs-order check, duplicate flag). Shown to the sale editor,
    Accounting, and Admin / Payment Approver; the reader appears only for VAT-inclusive / zero-rated deals.
  - Verify + duplicate flags are **advisory** (shown at read time) — the frozen Save/close-documents gates are unchanged.
- Typecheck + lint clean.

## 2026-08-20 · Job Order "eye view" — optional pixel-perfect PDF via a LibreOffice converter
- **Request (owner).** Proceed with the server-side converter for a PDF that matches the Excel template exactly.
- **Change (opt-in, feature-flagged; display path only).**
  - New `src/lib/xlsx-pdf.ts` `convertXlsxToPdf(buffer, filename)` — POSTs the built .xlsx to an external
    **Gotenberg-compatible LibreOffice** converter (`XLSX_PDF_CONVERTER_URL`, the full convert endpoint) and returns
    the PDF bytes; returns `null` (→ HTML-preview fallback) when unset, non-PDF, timed out (25 s), or failed.
  - `joXlsxResponse` (all four JO eye views) now: on `?view=1`, if the converter is configured, serve the
    **pixel-perfect PDF inline**; otherwise the improved HTML preview. `?download=1` still returns the raw .xlsx.
  - `.env.example` + README document the var and a self-host Gotenberg recipe. Vercel can't run LibreOffice, so the
    converter is a separate container (Railway/Render/Fly/VPS); self-host so JO documents stay in-house.
- Zero behaviour change until the owner deploys a converter and sets the env var. Typecheck + lint clean.

## 2026-08-20 · Job Order "eye view" — show the logo, trim blanks, add Print / Save as PDF
- **Request (owner).** The "eye" preview of a Job Order (the `?view=1` HTML render of the JO .xlsx) looked bare — no
  company logo and a big empty grid. Owner wanted a **PDF**. A true xlsx→PDF isn't possible on the host (only
  `@react-pdf/renderer`; no LibreOffice / headless browser), so the practical route: a faithful preview + one-click
  Save-as-PDF.
- **Change (`xlsx-to-html.ts`, shared preview renderer — not frozen; display only).**
  - Renders the workbook's **embedded images** (the template's logo / reference diagrams) as a banner above the grid —
    ExcelJS exposes them via `getImages()` / `getImage()` (verified: each fans template carries the logo PNG).
  - **Trims** the leading/trailing all-empty rows and trailing all-empty columns (the printable templates carry many
    blank spacer/header cells), so the preview shows the form, not a sea of blank cells. Merges are clamped to the
    trimmed range.
  - Adds print CSS (`@media print` hides the toolbar, `@page` margins) and a **Print / Save as PDF** button next to
    Download — so the eye view yields a clean PDF with the logo via the browser's Save-as-PDF.
- Applies to every JO type's preview (fans / duct / accessories / motor) and any other .xlsx preview. The JO .xlsx file
  itself is unchanged (download/print in Excel was always correct). Typecheck + lint clean.

## 2026-08-20 · Orders list — Purchaser sees Job Order numbers instead of Value/Collected/Balance
- **Request (owner).** For the **Purchaser** role, drop the Value / Collected / Balance columns on the Orders list and
  replace them with a single **Job Orders** column — the Engineer-generated JO numbers, all in one column, each
  clickable and opening the JO workflow.
- **Change (orders list, not frozen).** `orders/page.tsx` now derives each order's JO numbers per department (fans /
  duct / accessories / motor) via the existing formatters (`formatJoNumber`, `formatDuctJoNumber`,
  `formatAccessoriesJoNumber`, `formatMotorControllerJoNumber`) and passes an `isPurchaser` flag (holds the purchaser
  role, non-admin). In `orders-table.tsx`, the Purchaser view collapses the three money columns into one **Job Orders**
  column whose numbers are `Link`s to `/orders/<id>` (the JO workflow / Phase 2). Everyone else's view is unchanged;
  admins keep the full financial columns. colSpans adjust (10 → 8).
- Typecheck + lint clean.

## 2026-08-19 · WON report — book counter sales on completion (reconcile with the dashboard)
- **Bug (owner-reported).** "Sales this month" (dashboard) and the WON report grand total didn't tally — off by exactly
  the **uncleared** post-dated counter sales. Cause: the report's **Payment-date** basis dropped uncleared counter
  sales, while the dashboard booked every completed one.
- **Fix.** A completed counter sale is now **recognised (booked at full value) on completion on BOTH report bases** —
  never dropped for an uncleared post-dated check — with its unpaid amount showing in Collected/Balance, exactly like a
  confirmed quotation row that carries an outstanding balance. The report grand total now reconciles with the
  dashboard's "Sales this month".
- Typecheck + lint clean.

## 2026-08-19 · Counter sales now count in the Sales dashboard, Won & WON report
- **Bug (owner-reported).** Completed **Counter Sales** (walk-in cash sales) weren't adding up in the Sales dashboard,
  the Won tile, or the WON sales report. Cause: those aggregations only read `quotation` / `inquiry` — the separate
  `CounterSale` table was never included.
- **Fix (sales reporting, not frozen; owner-approved treatment).** A **completed** counter sale now books its full
  amount, credited to its **salesperson** (else the recorder), dated by **completion**:
  - **Sales dashboard** (`sales-dashboard-body.tsx`): folded into `salesMTD` (total sales this month), the
    per-salesperson map + top-salesperson-of-month, and the **Won** count (so counter sales lift the Won tile and win
    rate, per owner's choice). Quote-activity charts (daily/30-day quoted value, top *quoted* customers) stay
    quotation-only by design.
  - **WON sales report** (`sales-report.ts`): completed counter sales appear as rows (source "Counter Sale", credited
    to the salesperson). "Quotation-date" basis dates them by completion; "Payment-date" basis by clearing (an
    uncleared post-dated sale isn't booked as paid yet — mirrors orders). Row shape unchanged, so the view / xlsx /
    pdf / email exports all render them.
- Typecheck + lint clean.

## 2026-08-19 · Office stock transfer — flashing "next approver" badge on each card
- **Request (owner).** Replace the card's "Requested by …" header with the **name + designation of the next
  approver**, using the same **flashing** badge as the order flow.
- **Change (inventory office-transfer UI, not frozen).** Reused the order flow's `ApproverHighlight` (the blinking
  amber "Awaiting approval · <role> <names>" badge). New `nextOfficeTransferApprover(status, dir, salesNames)` maps the
  office chain to who acts next — REQUESTED→Plant Manager, APPROVED→Warehouse, RELEASED→Logistics,
  DELIVERING→Sales / Purchaser (null once RECEIVED / CANCELLED). The page resolves assigned names via
  `getApproverDirectory()` (+ base-role Sales users) and passes `nextApprover` per transfer; `OfficeTransferRow` shows
  the flashing badge while active, falling back to the plain "Requested by" once done. The requester + time stay
  visible in the timeline pill below, so nothing is lost.
- Typecheck + lint clean.

## 2026-08-19 · Office stock transfer — Purchaser can confirm "Office received"
- **Request (owner).** Authorize the **Purchaser** to press **Office Received** on an office stock transfer (was
  Sales / admin only).
- **Change (inventory office-transfer, not frozen).** `receiveOfficeTransfer` now also accepts the **purchaser**
  workflow role (`isAdmin || SALES || purchaser`), and the order page passes `canReceive = viewerIsSales ||
  viewerIsPurchaser`, so the button shows for the Purchaser. The "awaiting" hint now reads "Sales or Purchaser".
- Typecheck + lint clean.

## 2026-08-19 · Inventory — read-only view for Sales (no unit cost)
- **Request (owner).** Let the **Sales** role see Inventory, but **not the unit price** (supplier cost).
- **Change (permissions/UI, not frozen).** Sales now pass `canView` on the Inventory page and get the **Inventory** nav
  link. Their view is fully **read-only**: no add / import / edit / adjust / transfer / labels / reorder, and the
  **Stock transfers** panel is hidden. `canViewPrices` already returns false for Sales, so **unit cost, stock value
  and the value tile stay hidden**; `showSellPrice` stays true, so Sales see name / SKU / on-hand / available /
  **selling price** / status — the same read-only shape the Plant Manager already gets. Header copy adjusts for Sales.
- Typecheck + lint clean.

## 2026-08-19 · Stock labels — print the supplier barcode alongside the Item Code
- **Request (owner).** Show a **Barcode / SKU pair** on the printed labels.
- **Change (inventory UI, not frozen, display only).** Each stock label already prints Code 128 + QR of the **Item
  Code (SKU)**; when an item has an external **supplier barcode (GTIN)**, the label now also prints a second, labelled
  Code 128 for it — on the `/inventory/labels` sheet and in the per-row Label popover. `LabelItem.barcode` is optional,
  so the Products label page (no external barcode) is unaffected.
- Typecheck + lint clean.

## 2026-08-19 · Inventory — external barcode (GTIN) field on stock items
- **Request (owner).** Add a barcode/GTIN field, separate from the internal SKU, for the future retail/e-commerce
  layer and for scanning a supplier's printed barcode. (The internal Code128/QR labels already encode the SKU.)
- **Change (inventory, not frozen).**
  - Schema: `StockItem.barcode String? @unique` + **migration `0044_stock_barcode`** (additive `ADD COLUMN IF NOT
    EXISTS` + unique index + the standard enable-RLS block).
  - `createStockItem` + the New-item form take an optional **Supplier barcode**; `updateStockItemMeta` and the bulk
    importer (`barcode`/`gtin`/`upc`/`ean` column) can set it. All reject a barcode already used by another item.
  - The inventory **scan box** now resolves a scanned code by **barcode** as well as SKU/id/name — so scanning a
    supplier's GTIN jumps to / receives / issues the item. Export gains a `Barcode` column (round-trips via import).
- **⚠ Deploy note.** This adds a DB column, so migration `0044` MUST be applied to production **before** this code
  deploys (Prisma selects the column on every StockItem query — an unmigrated DB would 500, like the `storeListed`
  incident). Run the migration SQL in Supabase first, then merge. Kept **unmerged** pending that.
- Typecheck + lint clean.

## 2026-08-19 · Inventory — settable Item Code (SKU) + catalogue-code export (enables the matcher)
- **Context.** The stock matcher now keys on the SKU, but SKUs were **auto-generated numbers** with no way to set
  them — so the matcher was inert. This makes the Item Code settable and gives a reference export to drive re-labeling.
- **Editable Item Code (not frozen — inventory).**
  - `createStockItem` / the "New stock item" form take an optional **Item Code / SKU** (blank still auto-generates the
    next serial, so nothing changes for existing flows). `updateStockItemMeta` can also change it. Both normalise to
    UPPERCASE and reject a code already used by another item.
  - `importStockItems` reads an `sku` / `item code` / `code` column: it sets each matched item's code (match by name),
    or uses it on create. The inventory export already emits an `SKU` column, so **export → fill codes → re-import**
    is a clean bulk re-labeling round-trip.
- **Catalogue-code export.** New `GET /api/catalogue/export` streams a CSV of active `CatalogueItem`s
  (`sku,name,family,size,unit,store_listed`) — the worksheet of canonical Item Codes + standard names. A **"Export
  catalogue codes (CSV)"** link on the Products page (management roles only) downloads it; its headers match the
  inventory importer so it can be filled and re-imported directly. Non-sensitive (codes + names only).
- Typecheck + lint clean.

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
