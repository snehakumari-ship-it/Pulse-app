import { resolveIndianState } from "../indianStateCode.util";

describe("resolveIndianState", () => {
  it("maps known states to their two-letter code", () => {
    expect(resolveIndianState("Maharashtra")).toEqual({ name: "MAHARASHTRA", code: "MH" });
    expect(resolveIndianState("Tamil Nadu")).toEqual({ name: "TAMIL NADU", code: "TN" });
  });

  it("finds the state in a longer trailing address and skips country and pincode", () => {
    expect(resolveIndianState("Mumbai, Maharashtra 400001, India")).toEqual({
      name: "MAHARASHTRA",
      code: "MH",
    });
    expect(resolveIndianState("Andheri East, Maharashtra, India")).toEqual({
      name: "MAHARASHTRA",
      code: "MH",
    });
  });

  it("handles aliases and ampersands", () => {
    expect(resolveIndianState("Jammu & Kashmir")?.code).toBe("JK");
    expect(resolveIndianState("New Delhi")?.code).toBe("DL");
    expect(resolveIndianState("Orissa")?.code).toBe("OD");
  });

  it("falls back to initials for unknown names", () => {
    expect(resolveIndianState("Some Region")).toEqual({ name: "SOME REGION", code: "SR" });
    expect(resolveIndianState("Nowhere")).toEqual({ name: "NOWHERE", code: "NO" });
  });

  it("returns null when there is nothing usable", () => {
    expect(resolveIndianState(null)).toBeNull();
    expect(resolveIndianState("")).toBeNull();
    expect(resolveIndianState("India")).toBeNull();
  });
});
