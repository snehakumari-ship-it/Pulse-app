import {
  indentCancelReasonId,
  indentStatusForCancelReason,
  isIndentFailedStatus,
} from "@/features/indents/utils/indentCancelReason.util";

describe("indent cancel reasons", () => {
  it("recognises the four stored reason ids", () => {
    expect(indentCancelReasonId("client_cancelled")).toBe("client_cancelled");
    expect(indentCancelReasonId("indent_expired")).toBe("indent_expired");
    expect(indentCancelReasonId("no_rates_available")).toBe("no_rates_available");
    expect(indentCancelReasonId("wrong_entry")).toBe("wrong_entry");
    expect(indentCancelReasonId("other")).toBeNull();
    expect(indentCancelReasonId(null)).toBeNull();
  });

  it("treats cancelled and expired as failed", () => {
    expect(isIndentFailedStatus("cancelled")).toBe(true);
    expect(isIndentFailedStatus("expired")).toBe(true);
    expect(isIndentFailedStatus("open")).toBe(false);
    expect(isIndentFailedStatus("closed")).toBe(false);
    expect(isIndentFailedStatus("completed")).toBe(false);
  });

  it("maps indent expired onto the expired status", () => {
    expect(indentStatusForCancelReason("indent_expired")).toBe("expired");
    expect(indentStatusForCancelReason("wrong_entry")).toBe("cancelled");
    expect(indentStatusForCancelReason("client_cancelled")).toBe("cancelled");
    expect(indentStatusForCancelReason("no_rates_available")).toBe("cancelled");
  });
});
