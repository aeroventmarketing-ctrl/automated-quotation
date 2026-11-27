import { describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ prisma: {} }));
const { gateLocationsFor, coerceUserGeofences } = await import("./geofence");

const loc = (label: string) => ({ label, latitude: 14.5, longitude: 121, radiusMeters: 300 });

describe("where a user may use the app", () => {
  const off = { enabled: false, locations: [loc("HQ")] };
  const on = { enabled: true, locations: [loc("HQ")] };
  const mine = { u1: [loc("Plant"), loc("Office")] };

  it("no location set and the company geofence off → anywhere", () => {
    expect(gateLocationsFor({ id: "u2", admin: false }, off, mine)).toBeNull();
  });
  it("own locations set → only those (even when the company geofence is on)", () => {
    expect(gateLocationsFor({ id: "u1", admin: false }, off, mine)?.map((l) => l.label)).toEqual(["Plant", "Office"]);
    expect(gateLocationsFor({ id: "u1", admin: false }, on, mine)?.map((l) => l.label)).toEqual(["Plant", "Office"]);
  });
  it("no own locations, company geofence on → the company locations", () => {
    expect(gateLocationsFor({ id: "u2", admin: false }, on, mine)?.map((l) => l.label)).toEqual(["HQ"]);
  });
  it("an admin is never confined", () => {
    expect(gateLocationsFor({ id: "u1", admin: true }, on, mine)).toBeNull();
  });
  it("reads the stored map, dropping bad entries", () => {
    expect(coerceUserGeofences({ u1: [{ latitude: 1, longitude: 2 }, { latitude: "x" }], u2: [], u3: "no" })).toEqual({
      u1: [{ label: "", latitude: 1, longitude: 2, radiusMeters: 200 }],
    });
    expect(coerceUserGeofences(null)).toEqual({});
  });
});
