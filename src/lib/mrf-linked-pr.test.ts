import { describe, expect, it } from "vitest";
import { linkedPrByMrf } from "./mrf-linked-pr";

const pr = (id: string, mrfId: string | null, status: string, day: number) => ({ id, mrfId, status, createdAt: new Date(2026, 10, day) });

describe("linkedPrByMrf", () => {
  it("MRF #0624: two completed splits and a newer cancelled one — the MRF follows the completed one", () => {
    const m = linkedPrByMrf([pr("a", "m", "COMPLETED", 14), pr("b", "m", "COMPLETED", 19), pr("c", "m", "CANCELLED", 20)]);
    expect(m.get("m")?.id).toBe("b");
  });
  it("follows the newest live request, whatever order they arrive in", () => {
    const m = linkedPrByMrf([pr("c", "m", "REJECTED", 22), pr("b", "m", "CASH_RELEASED", 19), pr("a", "m", "COMPLETED", 14)]);
    expect(m.get("m")?.id).toBe("b");
  });
  it("every request dropped → the newest of them", () => {
    const m = linkedPrByMrf([pr("a", "m", "REJECTED", 14), pr("b", "m", "CANCELLED", 19)]);
    expect(m.get("m")?.status).toBe("CANCELLED");
  });
  it("a single request, and requests with no MRF", () => {
    const m = linkedPrByMrf([pr("a", "m", "APPROVED", 14), pr("x", null, "COMPLETED", 15)]);
    expect([...m.keys()]).toEqual(["m"]);
  });
});
