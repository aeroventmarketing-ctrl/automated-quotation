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
  // Everyone with a reason to look. Sales get a read-only, no-cost view. The
  // **Engineer** is here on the owner's instruction — *"allow inventory to
  // engineer role"* — closing the last of the nav-offers/page-refuses pairs the
  // grid found on its first run. Read only: every management cell below leaves
  // them false.
  canView: only("admin", "sales", "engineer", "warehouse", "purchaser", "paymentApprover", "accounting", "plantManager", "logistics", "prodHead"),
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
  // The record of decided requests: the same four, and nobody else — it names
  // people and quotes prices.
  canViewApprovalHistory: only("admin", "warehouse", "purchaser", "paymentApprover"),
  isPriceOwner: only("admin", "paymentApprover"),
};

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------
const PRODUCTS: Record<string, Record<Who, boolean>> = {
  // Sales are blocked entirely; they use Check availability instead.
  //
  // The **Engineer** is here on the owner's instruction — *"let the engineer
  // allowed by the page"* — closing a mismatch this grid found on its first run:
  // the nav offered them the Products tab and the page then refused it. Read
  // only; every other Products cell below leaves the Engineer false.
  //
  // NOTE — the same mismatch REMAINS for a base-role OTHER user holding no
  // workflow role at all (`nobody`): still offered the tab, still refused. Left
  // as current truth, because the fix there is arguably the other way round —
  // stop offering the tab to someone with no configured role — and that is the
  // owner's call, not this file's.
  canView: only("admin", "engineer", "warehouse", "purchaser", "paymentApprover", "accounting", "plantManager", "logistics", "prodHead"),
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

    it("the Engineer is offered the Inventory tab AND the page opens", () => {
      // The nav has always listed Inventory for an ENGINEER. Until the owner's
      // instruction the page refused them, which also stranded the unit cost,
      // stock value and Labels / Reorder links they were already cleared for.
      const a = inventoryAccess(...as("engineer"));
      expect(a.canView).toBe(true);
      expect(a.showPrices).toBe(true);
      expect(a.showHeaderTools).toBe(true);
      // Read only — the grant stops at looking.
      expect([a.canManageItems, a.canManageTransfers, a.canCreateItems, a.canDeleteItems, a.canProposeEdit, a.canEditPrices, a.canTransferFiles, a.canScan])
        .toEqual([false, false, false, false, false, false, false, false]);
    });

    it("the Engineer is offered the Products tab AND the page opens", () => {
      // The nav has always listed Products for an ENGINEER. Until the owner's
      // instruction the page refused them, so the tab was a dead end that also
      // stranded the prices and suppliers they were already cleared to see.
      const p = productsAccess(...as("engineer"));
      expect(p.canView).toBe(true);
      expect(p.showPrices).toBe(true);
      expect(p.showSuppliers).toBe(true);
      // Read only — the grant stops at looking.
      expect([p.canManage, p.canAddOrRemoveProducts, p.canEditPrices, p.canTransferFiles, p.canDecideChanges])
        .toEqual([false, false, false, false, false]);
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
