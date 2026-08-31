/**
 * THE CAPABILITY GRID — who can see and do what on Inventory and Products.
 *
 * Read this file as the policy, not as a test. Every rule in
 * `catalogue-access.ts` is asserted here for every role at once, so a change to
 * one rule fails on every cell it moves — including the cells nobody thought
 * about. That is the whole point: it makes the blast radius of a permission
 * change visible BEFORE someone clicks through eight screens and finds it.
 *
 * It exists because a run of individually-correct changes produced, among
 * others: an Inventory page that refused to open for the Payment Approver while
 * the nav badge counted their work, and a Payment Approver allowed by the server
 * to upload a catalogue file with no button to do it. Both are cells in the grid
 * below, and both would have failed here in seconds.
 *
 * **When you change a rule, change the expected table in the same commit** and
 * look hard at every other cell that moves with it.
 *
 * No database — pure functions only, so it runs everywhere and takes ~1ms.
 */
import { describe, it, expect } from "vitest";
import type { User } from "@prisma/client";
import type { WorkflowRoleAssignments } from "@/lib/workflow-roles";
import { inventoryAccess, productsAccess, CHAIN_NOTE } from "./catalogue-access";

/** The people who use these two screens, by the role they actually hold. */
const WHO = {
  admin: { base: "ADMIN", roles: [] },
  sales: { base: "SALES", roles: [] },
  engineer: { base: "ENGINEER", roles: [] },
  warehouse: { base: "OTHER", roles: ["warehouse"] },
  purchaser: { base: "OTHER", roles: ["purchaser"] },
  paymentApprover: { base: "OTHER", roles: ["payment_approver"] },
  accounting: { base: "OTHER", roles: ["accounting"] },
  plantManager: { base: "OTHER", roles: ["plant_manager"] },
  logistics: { base: "OTHER", roles: ["logistics"] },
  prodHead: { base: "OTHER", roles: ["prod_head_duct"] },
  nobody: { base: "OTHER", roles: [] },
} as const;
type Who = keyof typeof WHO;
const EVERYONE = Object.keys(WHO) as Who[];

const as = (w: Who): [User, WorkflowRoleAssignments] => [
  { id: w, name: w, email: `${w}@test`, role: WHO[w].base, salesCode: null, createdAt: new Date() } as unknown as User,
  { [w]: [...WHO[w].roles] },
];

/** `true` for the roles listed, `false` for everyone else — the grid's rows. */
const only = (...w: Who[]) => Object.fromEntries(EVERYONE.map((k) => [k, w.includes(k)])) as Record<Who, boolean>;

// ---------------------------------------------------------------------------
// INVENTORY
// ---------------------------------------------------------------------------
const INVENTORY: Record<keyof ReturnType<typeof inventoryAccess> & string, Record<Who, boolean>> | Record<string, Record<Who, boolean>> = {
  // Everyone with a reason to look. Sales get a read-only, no-cost view.
  canView: only("admin", "sales", "warehouse", "purchaser", "paymentApprover", "accounting", "plantManager", "logistics", "prodHead"),
  // Label / Reserve / Adjust: the people who hold the stock.
  canManageItems: only("admin", "warehouse"),
  // Wider than the item actions: the Plant Manager moves stock between locations.
  canManageTransfers: only("admin", "warehouse", "plantManager"),
  // + Add stock item / Merge duplicates / Delete selected: admin alone.
  canCreateItems: only("admin"),
  canDeleteItems: only("admin"),
  // Edit is a REQUEST, so it is wider — it runs the approval chain.
  canProposeEdit: only("admin", "warehouse", "purchaser", "paymentApprover"),
  // Setting a price outright belongs to the price owner.
  canEditPrices: only("admin", "paymentApprover"),
  // A spreadsheet is the catalogue in bulk, in or out.
  canTransferFiles: only("admin", "paymentApprover"),
  // Goods receipt on deliveries keeps the Purchaser on the scan box.
  canScan: only("admin", "warehouse", "purchaser"),
  // Money columns. The Warehouse manages stock without seeing its value.
  showPrices: only("admin", "engineer", "purchaser", "paymentApprover", "accounting"),
  // Sell price is narrower still — not for the people who buy or count.
  showSellPrice: only("admin", "sales", "engineer", "paymentApprover", "plantManager", "logistics", "prodHead", "nobody"),
  // Labels / Reorder: those target pages deny everyone else.
  showHeaderTools: only("admin", "engineer", "purchaser", "nobody"),
  // The four parties to a request see it float to the top.
  pendingFirst: only("admin", "warehouse", "purchaser", "paymentApprover"),
  isPriceOwner: only("admin", "paymentApprover"),
};

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------
const PRODUCTS: Record<string, Record<Who, boolean>> = {
  // Sales are blocked entirely; they use Check availability instead.
  //
  // NOTE — a mismatch this grid found on its first run, recorded as the current
  // truth rather than quietly "fixed": an **Engineer** (and a base-role OTHER
  // user with no workflow role) is offered the Products tab by `visibleNav` and
  // then refused by the page. Engineers already see prices everywhere else, so
  // this looks like the same nav-offers/page-refuses shape as the Payment
  // Approver bug. Widening who may read the catalogue is the owner's call, so it
  // is flagged, not changed.
  canView: only("admin", "warehouse", "purchaser", "paymentApprover", "accounting", "plantManager", "logistics", "prodHead"),
  // Per-row Edit. The Purchaser's save is parked for the price owner.
  canManage: only("admin", "purchaser", "paymentApprover"),
  // The two list-shaping buttons the owner took off the Purchaser.
  canAddOrRemoveProducts: only("admin", "paymentApprover"),
  canEditPrices: only("admin", "paymentApprover"),
  canTransferFiles: only("admin", "paymentApprover"),
  showPrices: only("admin", "engineer", "purchaser", "paymentApprover", "accounting"),
  showSuppliers: only("admin", "engineer", "purchaser", "paymentApprover", "accounting"),
  canDecideChanges: only("admin", "paymentApprover"),
  isPriceOwner: only("admin", "paymentApprover"),
};

describe("the catalogue capability grid", () => {
  describe("Inventory", () => {
    for (const [capability, expected] of Object.entries(INVENTORY)) {
      it(capability, () => {
        const actual = Object.fromEntries(
          EVERYONE.map((w) => [w, (inventoryAccess(...as(w)) as unknown as Record<string, boolean>)[capability]]),
        );
        expect(actual).toEqual(expected);
      });
    }
  });

  describe("Products", () => {
    for (const [capability, expected] of Object.entries(PRODUCTS)) {
      it(capability, () => {
        const actual = Object.fromEntries(
          EVERYONE.map((w) => [w, (productsAccess(...as(w)) as unknown as Record<string, boolean>)[capability]]),
        );
        expect(actual).toEqual(expected);
      });
    }
  });

  // The sentence under a proposal panel has to name the steps the SERVER will
  // actually run, so it is part of the policy rather than copy.
  it("tells each proposer the right remaining steps", () => {
    expect(inventoryAccess(...as("paymentApprover")).chainNote).toBe(CHAIN_NOTE.owner);
    expect(inventoryAccess(...as("admin")).chainNote).toBe(CHAIN_NOTE.owner);
    expect(inventoryAccess(...as("warehouse")).chainNote).toBe(CHAIN_NOTE.warehouse);
    expect(inventoryAccess(...as("purchaser")).chainNote).toBe(CHAIN_NOTE.other);
  });

  // The two regressions that reached the owner, pinned by name so a future
  // change to the surrounding rules has to confront them.
  describe("regressions", () => {
    it("the Payment Approver can open Inventory and see what they are signing", () => {
      const a = inventoryAccess(...as("paymentApprover"));
      expect(a.canView).toBe(true);
      expect(a.showPrices).toBe(true);
    });

    it("whoever may upload a catalogue file can also see the button", () => {
      // Both screens: the capability was granted on the server and the Inventory
      // screen rendered the import inside a narrower gate, so the Payment
      // Approver was allowed to upload with no way to.
      for (const w of EVERYONE) {
        expect(inventoryAccess(...as(w)).canTransferFiles).toBe(productsAccess(...as(w)).canTransferFiles);
      }
    });

    it("nobody is offered a page-level action they cannot reach the page for", () => {
      for (const w of EVERYONE) {
        const inv = inventoryAccess(...as(w));
        if (!inv.canView) {
          expect([inv.canManageItems, inv.canProposeEdit, inv.canEditPrices, inv.canTransferFiles, inv.canScan])
            .toEqual([false, false, false, false, false]);
        }
        const pro = productsAccess(...as(w));
        if (!pro.canView) {
          expect([pro.canManage, pro.canAddOrRemoveProducts, pro.canEditPrices, pro.canTransferFiles])
            .toEqual([false, false, false, false]);
        }
      }
    });
  });
});
