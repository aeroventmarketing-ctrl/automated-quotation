/**
 * "Confirm materials received" on My Dashboard — the owner's *"show only the task
 * related to each role except for admin role"*, and their answer for Office MRFs:
 * **the person who raised it**, plus Admin.
 */
import { describe, it, expect } from "vitest";
import { showsConfirmReceiptTask, accountNameSet } from "./mrf-confirm-task";

const ACCOUNTS = accountNameSet(["Joemel Jamero", "purcharser", "Rey Gil", "Desiree Enigo", "Admin Ana"]);
const OFFICE = { office: true, raisedByName: "Joemel Jamero" };

const viewer = (name: string, over: { admin?: boolean; mayConfirm?: boolean } = {}) => ({
  name,
  admin: over.admin ?? false,
  mayConfirm: over.mayConfirm ?? true,
});

describe("an Office MRF", () => {
  it("goes to the person who raised it", () => {
    expect(showsConfirmReceiptTask(OFFICE, viewer("Joemel Jamero"), ACCOUNTS)).toBe(true);
  });

  it("not to the Purchaser who didn't — the owner's screenshot", () => {
    expect(showsConfirmReceiptTask(OFFICE, viewer("purcharser"), ACCOUNTS)).toBe(false);
  });

  it("nor to the Payment Approver, nor another salesperson", () => {
    expect(showsConfirmReceiptTask(OFFICE, viewer("Rey Gil"), ACCOUNTS)).toBe(false);
    expect(showsConfirmReceiptTask(OFFICE, viewer("Desiree Enigo"), ACCOUNTS)).toBe(false);
  });

  it("but always to Admin — the owner's exception", () => {
    expect(showsConfirmReceiptTask(OFFICE, viewer("Admin Ana", { admin: true }), ACCOUNTS)).toBe(true);
  });

  it("matches the name the way it was stamped, forgiving spacing and case", () => {
    expect(showsConfirmReceiptTask({ office: true, raisedByName: "  joemel   JAMERO " }, viewer("Joemel Jamero"), ACCOUNTS)).toBe(true);
  });
});

describe("the orphan guard", () => {
  it("a raiser no account answers to → back to every Office seat, so nobody's list loses it", () => {
    const orphan = { office: true, raisedByName: "Someone Who Left" };
    expect(showsConfirmReceiptTask(orphan, viewer("purcharser"), ACCOUNTS)).toBe(true);
    expect(showsConfirmReceiptTask(orphan, viewer("Rey Gil"), ACCOUNTS)).toBe(true);
  });

  it("no raiser recorded at all → the same", () => {
    expect(showsConfirmReceiptTask({ office: true, raisedByName: "" }, viewer("purcharser"), ACCOUNTS)).toBe(true);
  });
});

describe("never wider than the server's own rule", () => {
  it("someone who may not confirm is never shown it — even the raiser's namesake", () => {
    expect(showsConfirmReceiptTask(OFFICE, viewer("Joemel Jamero", { mayConfirm: false }), ACCOUNTS)).toBe(false);
  });
});

describe("a production-department MRF", () => {
  it("is unchanged: its department head gets it, whoever raised it", () => {
    const duct = { office: false, raisedByName: "Joemel Jamero" };
    expect(showsConfirmReceiptTask(duct, viewer("Duct Head"), ACCOUNTS)).toBe(true);
  });
});
