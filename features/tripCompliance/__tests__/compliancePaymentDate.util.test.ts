import {
  formatComplianceTxnDate,
  normalizeComplianceTransactionDate,
  toComplianceTransactionDateInput,
  validateComplianceTransactionDate,
} from "@/features/tripCompliance/utils/compliancePaymentDate.util";

describe("compliancePaymentDate.util", () => {
  it("normalizes ISO and YYYY-MM-DD to a calendar day", () => {
    expect(toComplianceTransactionDateInput("2026-10-05")).toBe("2026-10-05");
    expect(toComplianceTransactionDateInput("2026-10-05T00:00:00.000Z").startsWith("2026-10-")).toBe(true);
    expect(normalizeComplianceTransactionDate(" 2026-10-05 ")).toBe("2026-10-05");
  });

  it("validates dates", () => {
    expect(validateComplianceTransactionDate("")).toMatch(/enter/i);
    expect(validateComplianceTransactionDate("2026-13-01")).toMatch(/valid/i);
    expect(validateComplianceTransactionDate("2026-10-05")).toBeNull();
  });

  it("formats txn dates for the table", () => {
    expect(formatComplianceTxnDate("2026-10-05")).toBe("05 Oct 2026");
    expect(formatComplianceTxnDate(null)).toBe("—");
  });
});
