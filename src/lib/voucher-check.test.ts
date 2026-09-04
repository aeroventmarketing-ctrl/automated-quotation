import { describe, it, expect } from "vitest";
import type { PRStatus } from "./purchasing";
import { PR_MAIN_ORDER, prMainIndex, statusBucket } from "./purchasing";
import { pesoAmountInWords } from "./amount-words";
import {
  canAttachCheck, checkExpected, checkMissing, checkAttachableAt, coerceCheckDocs,
  checkIssues, checkNumbers, sameCompany, amountMatchesWords, normalizeCheckNo, formatCheckNo, CHECK_NO_DIGITS,
  clearingFromDateBoxes,
  type CheckRead,
} from "./voucher-check";

/**
 * The owner, on a check whose date came back a month and a half early:
 * *"date error in check reading. When reading check date, 10-04-2026 means
 * October 4, 2026."*
 *
 * The boxes on the check are labelled `M M  D D  Y Y Y Y`, so month is always
 * first. The model is no longer asked to work the date out — it transcribes the
 * eight digits and the order is applied here.
 */
describe("the DATE boxes, read MM DD YYYY", () => {
  it("reads the owner's own check as October, not April", () => {
    expect(clearingFromDateBoxes("10042026")).toBe("2026-10-04");
  });

  it("reads every ambiguous pair by POSITION, never by which number looks like a day", () => {
    expect(clearingFromDateBoxes("03112026")).toBe("2026-03-11"); // 11 March, not 3 November
    expect(clearingFromDateBoxes("01122026")).toBe("2026-01-12"); // 12 January, not 1 December
    expect(clearingFromDateBoxes("12012026")).toBe("2026-12-01");
  });

  it("still reads the unambiguous one the same way", () => {
    expect(clearingFromDateBoxes("10172026")).toBe("2026-10-17");
  });

  it("accepts the digits however they arrive from the boxes", () => {
    expect(clearingFromDateBoxes("10 04 2026")).toBe("2026-10-04");
    expect(clearingFromDateBoxes("10-04-2026")).toBe("2026-10-04");
  });

  it("refuses a date nobody can defend, rather than inventing one", () => {
    expect(clearingFromDateBoxes("13042026")).toBeNull(); // no 13th month
    expect(clearingFromDateBoxes("02312026")).toBeNull(); // no 31 February
    expect(clearingFromDateBoxes("00042026")).toBeNull();
    expect(clearingFromDateBoxes("1042026")).toBeNull(); // seven digits — a box was missed
    expect(clearingFromDateBoxes("100420261")).toBeNull();
    expect(clearingFromDateBoxes("10041926")).toBeNull(); // a company check, not an heirloom
    expect(clearingFromDateBoxes("")).toBeNull();
    expect(clearingFromDateBoxes(null)).toBeNull();
  });

  it("leaves a leap day alone", () => {
    expect(clearingFromDateBoxes("02292028")).toBe("2028-02-29");
    expect(clearingFromDateBoxes("02292026")).toBeNull(); // 2026 is not a leap year
  });
});

const doc = { path: "purchases/pr1/1.jpg", name: "check.jpg", uploadedAt: "", uploadedByName: "A" };

describe("who may attach a check photo", () => {
  // The owner's answer, whole: *"Accounting, Payment Approver and Admin."*
  const CAN: Array<[string, { admin: boolean; workflowRoles: string[] }, boolean]> = [
    ["Admin", { admin: true, workflowRoles: [] }, true],
    ["Accounting", { admin: false, workflowRoles: ["accounting"] }, true],
    ["Payment Approver", { admin: false, workflowRoles: ["payment_approver"] }, true],
    // …and everyone else, including the people closest to the money.
    ["Purchaser", { admin: false, workflowRoles: ["purchaser"] }, false],
    ["Plant Manager", { admin: false, workflowRoles: ["plant_manager"] }, false],
    ["Warehouse", { admin: false, workflowRoles: ["warehouse"] }, false],
    ["Logistics Head", { admin: false, workflowRoles: ["logistics_head"] }, false],
    ["nobody in particular", { admin: false, workflowRoles: [] }, false],
  ];
  for (const [who, opts, expected] of CAN) {
    it(who, () => expect(canAttachCheck(opts)).toBe(expected));
  }
});

describe("when a check is expected", () => {
  it("never for a cash supplier, at any stage", () => {
    for (const status of PR_MAIN_ORDER) {
      expect(checkExpected({ supplierGivesTerms: false, status }), status).toBe(false);
    }
  });

  it("for a terms supplier, from Voucher & Check Signed onwards", () => {
    const before: PRStatus[] = ["PENDING_APPROVAL", "APPROVED", "VOUCHER_READY"];
    const after: PRStatus[] = ["VOUCHER_SIGNED", "CASH_RELEASED", "PURCHASED", "RECEIVED", "COMPLETED"];
    for (const status of before) expect(checkExpected({ supplierGivesTerms: true, status }), status).toBe(false);
    for (const status of after) expect(checkExpected({ supplierGivesTerms: true, status }), status).toBe(true);
  });

  it("never chases a cancelled or rejected PO", () => {
    for (const status of ["CANCELLED", "REJECTED"] as PRStatus[]) {
      expect(checkExpected({ supplierGivesTerms: true, status })).toBe(false);
    }
  });
});

/**
 * The owner's rule: *"attaching check must be active only on purchasing budgeted
 * tab. Hide or disable check uploading in pending, approved, cancelled and
 * rejected. Checks can always be viewed in completed department PO but uploading
 * is disabled."*
 *
 * Asserted against the workspace's OWN tab function rather than a hand-written
 * list, so the two can't drift: whatever `displayBucket` calls "budgeted" is what
 * this must allow — minus COMPLETED, which sits in that bucket and which the
 * owner singled out as view-only.
 */
describe("when a check may be attached", () => {
  // A copy of the workspace's displayBucket (purchasing-workspace.tsx), which is
  // local to that client component.
  const tabOf = (status: PRStatus, ctx?: { isDept?: boolean; poApproved?: boolean }) => {
    const b = statusBucket(status, ctx);
    return b === "approved" && prMainIndex(status) >= prMainIndex("VOUCHER_SIGNED") ? "budgeted" : b;
  };

  it("is exactly the Budgeted tab, less COMPLETED", () => {
    for (const status of [...PR_MAIN_ORDER, "REJECTED", "CANCELLED"] as PRStatus[]) {
      const expected = tabOf(status) === "budgeted" && status !== "COMPLETED";
      expect(checkAttachableAt(status), `${status} (tab: ${tabOf(status)})`).toBe(expected);
    }
  });

  it("names the tabs the owner listed", () => {
    // Pending and Approved — no check has been signed yet.
    expect(checkAttachableAt("PENDING_APPROVAL")).toBe(false);
    expect(checkAttachableAt("APPROVED")).toBe(false);
    expect(checkAttachableAt("VOUCHER_READY")).toBe(false);
    // Rejected and Cancelled — no money moved.
    expect(checkAttachableAt("REJECTED")).toBe(false);
    expect(checkAttachableAt("CANCELLED")).toBe(false);
    // Budgeted — the whole live span of the PO.
    for (const s of ["VOUCHER_SIGNED", "CASH_RELEASED", "PURCHASED", "RECEIVED", "PLANT_APPROVED"] as PRStatus[]) {
      expect(checkAttachableAt(s), s).toBe(true);
    }
    // Completed — view only, wherever it renders.
    expect(checkAttachableAt("COMPLETED")).toBe(false);
  });

  it("keeps a department requisition out until the Approver has approved its PO", () => {
    // A dept MRF at APPROVED is only Plant-Manager-approved; it still reads as
    // "pending" until `poApproved`, and it has no check either way.
    expect(checkAttachableAt("APPROVED", { isDept: true, poApproved: false })).toBe(false);
    expect(checkAttachableAt("APPROVED", { isDept: true, poApproved: true })).toBe(false);
  });

  it("does not change whether a check is EXPECTED — only whether it can be attached", () => {
    // A completed PO with no check is still a gap on the record; the amber badge
    // stays, it just can't be cleared from that screen any more.
    expect(checkExpected({ supplierGivesTerms: true, status: "COMPLETED" })).toBe(true);
    expect(checkMissing({ supplierGivesTerms: true, status: "COMPLETED", docs: [] })).toBe(true);
    expect(checkAttachableAt("COMPLETED")).toBe(false);
  });
});

describe("checkMissing", () => {
  it("flags a terms PO past signing with no photo", () => {
    expect(checkMissing({ supplierGivesTerms: true, status: "CASH_RELEASED", docs: [] })).toBe(true);
  });
  it("stops flagging once a photo is attached", () => {
    expect(checkMissing({ supplierGivesTerms: true, status: "CASH_RELEASED", docs: [doc] })).toBe(false);
  });
  it("does not flag a cash supplier that will never have a check", () => {
    expect(checkMissing({ supplierGivesTerms: false, status: "COMPLETED", docs: [] })).toBe(false);
  });
});

describe("coerceCheckDocs", () => {
  it("survives whatever is in the column", () => {
    expect(coerceCheckDocs(null)).toEqual([]);
    expect(coerceCheckDocs({})).toEqual([]);
    expect(coerceCheckDocs(["nope", 1, null, { name: "no path" }])).toEqual([]);
  });
  it("fills in the fields an older row may not have", () => {
    expect(coerceCheckDocs([{ path: "purchases/p/1.jpg" }])).toEqual([
      { path: "purchases/p/1.jpg", name: "check", uploadedAt: "", uploadedByName: "" },
    ]);
  });
});

// --- Reading the check -------------------------------------------------------
//
// The fixture is the owner's own practice check, field for field:
//   Account No. 003718007033 · AEROVENT FANS AND BLOWERS MANUFACTURING ·
//   Check No. 0000486722 · pay to POWERLINK MERCHANDISE TRADING CORPORATION ·
//   10-17-2026 · ₱20,827.37 · "TWENTY THOUSAND EIGHT HUNDRED TWENTY SEVEN AND 37/100"
const PRACTICE: CheckRead = {
  accountNo: "003718007033",
  accountName: "AEROVENT FANS AND BLOWERS MANUFACTURING",
  checkNo: "0000486722",
  payee: "POWERLINK MERCHANDISE TRADING CORPORATION",
  clearingYMD: "2026-10-17",
  dateBoxes: "10172026",
  amount: 20827.37,
  amountWords: "TWENTY THOUSAND EIGHT HUNDRED TWENTY SEVEN AND 37/100",
  amountFigures: null,
  bank: "BDO",
  confidence: 0.95,
  warnings: [],
  issues: [],
  readByName: "Michelle Cotura",
  readAt: "2026-09-03T01:00:00.000Z",
};
const OURS = "AEROVENT FANS & BLOWERS MANUFACTURING";
const ok = (over: Partial<Parameters<typeof checkIssues>[0]> = {}) =>
  checkIssues({
    read: PRACTICE,
    supplierCompany: "POWERLINK MERCHANDISE TRADING CORPORATION",
    netAmount: 20827.37,
    ourCompany: OURS,
    inWords: pesoAmountInWords,
    ...over,
  });

describe("the practice check", () => {
  it("agrees with its PO on every point we can test", () => {
    expect(ok()).toEqual([]);
  });

  it("matches its own words — the check's cross-check on its face", () => {
    // Our speller hyphenates ("TWENTY-SEVEN"); the check does not. The comparison
    // must ignore that, or every correct check would be reported as wrong.
    expect(pesoAmountInWords(20827.37)).toBe("TWENTY THOUSAND EIGHT HUNDRED TWENTY-SEVEN AND 37/100");
    expect(amountMatchesWords(20827.37, PRACTICE.amountWords, pesoAmountInWords)).toBe(true);
  });

  it("accepts the zero-centavo tail a check always writes and we never do", () => {
    // Our speller stops at the peso: `pesoAmountInWords(2180)` has no tail. A
    // check always writes one, because a blank there is where a fraud gets
    // written in. Every round-amount check would otherwise read as a mismatch.
    expect(pesoAmountInWords(2180)).toBe("TWO THOUSAND ONE HUNDRED EIGHTY");
    for (const words of [
      // The owner's house style — *"per 00/100 we use the words 'only' in
      // check"* — in every form a hand or a printer produces it.
      "TWO THOUSAND ONE HUNDRED EIGHTY PESOS ONLY",
      "TWO THOUSAND ONE HUNDRED EIGHTY ONLY",
      "Two Thousand One Hundred Eighty Pesos Only",
      "TWO THOUSAND ONE HUNDRED EIGHTY PESOS ONLY.",
      "** TWO THOUSAND ONE HUNDRED EIGHTY PESOS ONLY **",
      // …and the fraction forms other banks and check printers use.
      "TWO THOUSAND ONE HUNDRED EIGHTY AND 00/100",
      "TWO THOUSAND ONE HUNDRED EIGHTY AND NO/100",
      "Two Thousand One Hundred Eighty",
    ]) {
      expect(amountMatchesWords(2180, words, pesoAmountInWords), words).toBe(true);
    }
    // "ONLY" closes the line; it never excuses centavos that are actually there.
    expect(amountMatchesWords(2160.54, "TWO THOUSAND ONE HUNDRED SIXTY PESOS ONLY", pesoAmountInWords)).toBe(false);
    expect(amountMatchesWords(2160.54, "TWO THOUSAND ONE HUNDRED SIXTY AND 54/100 ONLY", pesoAmountInWords)).toBe(true);
    // A real centavo tail is still part of the amount, and still has to agree.
    expect(amountMatchesWords(2160.54, "TWO THOUSAND ONE HUNDRED SIXTY AND 54/100", pesoAmountInWords)).toBe(true);
    expect(amountMatchesWords(2160.54, "TWO THOUSAND ONE HUNDRED SIXTY AND 45/100", pesoAmountInWords)).toBe(false);
    expect(amountMatchesWords(2160.54, "TWO THOUSAND ONE HUNDRED SIXTY AND 00/100", pesoAmountInWords)).toBe(false);
  });

  it("survives the company name being written our way or the bank's", () => {
    // "&" vs "AND", and the suffixes suppliers drop at will.
    expect(sameCompany("AEROVENT FANS AND BLOWERS MANUFACTURING", OURS)).toBe(true);
    expect(sameCompany("Powerlink Merchandise Trading Corp.", "POWERLINK MERCHANDISE TRADING CORPORATION")).toBe(true);
    expect(sameCompany("TOZEN PHILIPPINES INC.", "POWERLINK MERCHANDISE TRADING CORPORATION")).toBe(false);
  });
});

describe("what the read is cross-examined against", () => {
  it("flags a check made out to someone other than this PO's supplier", () => {
    const issues = ok({ supplierCompany: "TOZEN PHILIPPINES INC." });
    expect(issues.map((i) => i.key)).toContain("payee");
  });

  it("flags a check written for a different amount than the PO's net", () => {
    expect(ok({ netAmount: 2160.54 }).map((i) => i.key)).toContain("amount");
  });

  // The owner's ruling, asked directly against their own TOZEN PO — which reads
  // "₱2,180.00 · Net ₱2,160.54", the difference being the 1% EWT we withhold and
  // remit ourselves: *the check equals the NET.* Pinned because the two figures
  // sit side by side on the card and picking the wrong one would flag every
  // EWT supplier's check as a mismatch.
  it("judges the check against the PO's NET, not its gross total", () => {
    const withEwt = { netAmount: 2160.54, supplierCompany: "TOZEN PHILIPPINES INC." };
    const forNet = { ...PRACTICE, amount: 2160.54, amountWords: "TWO THOUSAND ONE HUNDRED SIXTY AND 54/100", payee: "TOZEN PHILIPPINES INC." };
    expect(ok({ ...withEwt, read: forNet })).toEqual([]);
    // The same check written for the gross is the error this is here to catch.
    const forGross = { ...forNet, amount: 2180, amountWords: "TWO THOUSAND ONE HUNDRED EIGHTY AND 00/100" };
    expect(ok({ ...withEwt, read: forGross }).map((i) => i.key)).toEqual(["amount"]);
  });

  it("says which two figures disagree, in pesos a person can read", () => {
    const [issue] = ok({ netAmount: 2160.54 });
    expect(issue.message).toBe("Check is for ₱20,827.37 but this PO's net is ₱2,160.54.");
  });

  it("flags figures and words that disagree — a digit misread, or a bad check", () => {
    const read = { ...PRACTICE, amountWords: "TWENTY THOUSAND EIGHT HUNDRED TWENTY SIX AND 37/100" };
    expect(ok({ read }).map((i) => i.key)).toContain("words");
  });

  /**
   * The owner's TOZEN PO: *"please check. Error in AI reading, Check and Net
   * Amount is tally."* The check was for ₱2,081.25 and the peso box came back
   * read as ₱2,018.25 — the same digits, two of them swapped.
   */
  it("takes the amount from the words and says which figure it used", () => {
    const read = {
      ...PRACTICE,
      payee: "TOZEN PHILIPPINES INC.",
      amount: 2081.25, // from the words, as the route now sets it
      amountFigures: 2018.25, // what the peso box appeared to say
      amountWords: "TWO THOUSAND EIGHTY-ONE AND 25/100",
    };
    const issues = ok({ read, netAmount: 2081.25, supplierCompany: "TOZEN PHILIPPINES INC." });
    // No amount issue: the check and the PO's net DO tally, which was the point.
    expect(issues.map((i) => i.key)).toEqual(["words"]);
    expect(issues[0].message).toBe(
      "The peso box reads ₱2,018.25 but the words say ₱2,081.25. The written amount governs on a check, so ₱2,081.25 was used.",
    );
  });

  it("names a transposition for what it is, instead of accusing the check", () => {
    // Same digits, different order — that is a misread, not a wrong payment,
    // and the two call for different actions.
    const [issue] = ok({ read: { ...PRACTICE, amount: 2018.25 }, netAmount: 2081.25 });
    expect(issue.message).toContain("same digits in a different order");
    expect(issue.message).toContain("re-read the photo");
    // A genuinely different amount gets no such excuse.
    const [plain] = ok({ read: { ...PRACTICE, amount: 5000 }, netAmount: 2081.25 });
    expect(plain.message).toBe("Check is for ₱5,000.00 but this PO's net is ₱2,081.25.");
  });

  it("flags a check drawn on an account that isn't ours", () => {
    const read = { ...PRACTICE, accountName: "SOME OTHER COMPANY INC." };
    expect(ok({ read }).map((i) => i.key)).toContain("account");
  });

  it("flags a check number already recorded on another PO", () => {
    // Leading zeros and any formatting are ignored on both sides.
    expect(ok({ usedCheckNos: ["486722"] }).map((i) => i.key)).toContain("duplicate");
    expect(ok({ usedCheckNos: ["0000486723"] })).toEqual([]);
  });

  it("flags a photo the model wasn't sure of", () => {
    expect(ok({ read: { ...PRACTICE, confidence: 0.4 } }).map((i) => i.key)).toContain("confidence");
  });

  it("says so when the check hasn't been read at all", () => {
    expect(ok({ read: undefined }).map((i) => i.key)).toEqual(["unread"]);
  });

  it("stays quiet about fields the read couldn't make out", () => {
    // A photo with glare over the date is still worth keeping for the number —
    // it must not be reported as a mismatch on the fields it left null.
    const read = { ...PRACTICE, payee: null, amount: null, amountWords: null, accountName: null };
    expect(ok({ read })).toEqual([]);
  });
});

describe("check numbers", () => {
  it("collects the ones that were read, ignoring the ones that weren't", () => {
    expect(checkNumbers([
      { ...doc, path: "a", read: PRACTICE },
      { ...doc, path: "b" },
      { ...doc, path: "c", read: { ...PRACTICE, checkNo: null } },
    ])).toEqual(["0000486722"]);
  });

  /**
   * The owner's ruling: *"In the file I sent you is 6 digit check number with
   * 0000 before the first number. We will be using the 10 digit check number
   * from now on."* Their hand-kept register abbreviates to the six significant
   * digits; the check itself reads ten.
   */
  it("shows the canonical 10-digit form, whichever form was read", () => {
    expect(CHECK_NO_DIGITS).toBe(10);
    expect(formatCheckNo("486625")).toBe("0000486625");      // the register's short form
    expect(formatCheckNo("0000486625")).toBe("0000486625");  // already canonical
    expect(formatCheckNo("1")).toBe("0000000001");
  });

  it("leaves alone anything that isn't a plain run of fewer than ten digits", () => {
    // A number that doesn't fit the pattern is likelier a misread than something
    // to pad into looking correct.
    expect(formatCheckNo("00004866251")).toBe("00004866251"); // longer — untouched
    expect(formatCheckNo("486-625")).toBe("486-625");         // punctuation — untouched
    expect(formatCheckNo("01053-313-0")).toBe("01053-313-0"); // a BRSTN, not a check no.
    expect(formatCheckNo("")).toBeNull();
    expect(formatCheckNo(null)).toBeNull();
  });

  it("makes both forms findable in the Purchasing search box", () => {
    // Whoever is holding the printed check types ten digits; whoever is reading
    // the register types six. Both must find the same PO.
    const nums = checkNumbers([{ ...doc, read: { ...PRACTICE, checkNo: "486625" } }]);
    expect(nums).toEqual(["486625", "0000486625"]);
    // Already canonical — no pointless duplicate.
    expect(checkNumbers([{ ...doc, read: PRACTICE }])).toEqual(["0000486722"]);
  });

  it("compares on the digits that identify the check, not the printed padding", () => {
    expect(normalizeCheckNo("486-722")).toBe("486722");
    expect(normalizeCheckNo("No. 0000486722")).toBe("486722");
    expect(normalizeCheckNo("0")).toBe("0"); // never eat the number entirely
  });

  it("round-trips a read through the column", () => {
    const [back] = coerceCheckDocs([{ ...doc, read: PRACTICE }]);
    expect(back.read).toEqual(PRACTICE);
  });

  it("keeps a doc whose stored read is junk, without the read", () => {
    const [back] = coerceCheckDocs([{ ...doc, read: "not an object" }]);
    expect(back.path).toBe(doc.path);
    expect(back.read).toBeUndefined();
  });
});
