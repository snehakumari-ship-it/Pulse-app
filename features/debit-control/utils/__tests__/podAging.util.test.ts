import {
  formatPodReceivingAging,
  podDelaySubmissionAmount,
  podReceivingAging,
} from "@/features/debit-control/utils/podAging.util";

describe("pod receiving aging", () => {
  it("waits for both dates", () => {
    expect(podReceivingAging("2026-09-01", "")).toBeNull();
    expect(podReceivingAging("", "2026-09-20")).toBeNull();
  });

  it("charges nothing through the 15th day", () => {
    expect(podReceivingAging("2026-09-01", "2026-09-16")).toEqual({ days: 15, penalty: 0 });
  });

  it("charges 50 rupees for each day after the free window", () => {
    expect(podReceivingAging("2026-09-01", "2026-09-17")).toEqual({ days: 16, penalty: 50 });
    expect(podReceivingAging("2026-09-01", "2026-09-21")).toEqual({ days: 20, penalty: 250 });
  });

  it("does not charge when the POD is dispatched on or before delivery", () => {
    expect(podReceivingAging("2026-09-16", "2026-09-16")).toEqual({ days: 0, penalty: 0 });
    expect(podReceivingAging("2026-09-17", "2026-09-16")?.penalty).toBe(0);
  });

  it("counts from -15 to 0 with no penalty, then from 1 with the charge", () => {
    expect(formatPodReceivingAging(null)).toBe("—");
    expect(formatPodReceivingAging(podReceivingAging("2026-09-01", "2026-09-01"))).toBe("-15 days");
    expect(formatPodReceivingAging(podReceivingAging("2026-09-01", "2026-09-15"))).toBe("-1 day");
    expect(formatPodReceivingAging(podReceivingAging("2026-09-01", "2026-09-16"))).toBe("0 days");
    expect(formatPodReceivingAging(podReceivingAging("2026-09-01", "2026-09-17"))).toBe("1 day - ₹50");
    expect(formatPodReceivingAging(podReceivingAging("2026-09-01", "2026-09-21"))).toBe("5 days - ₹250");
  });

  it("fills POD delay submission only after the free window", () => {
    expect(podDelaySubmissionAmount(0)).toBe("");
    expect(podDelaySubmissionAmount(podReceivingAging("2026-09-01", "2026-09-16")?.penalty)).toBe("");
    expect(podDelaySubmissionAmount(podReceivingAging("2026-09-01", "2026-09-17")?.penalty)).toBe("50");
    expect(podDelaySubmissionAmount(podReceivingAging("2026-09-01", "2026-09-19")?.penalty)).toBe("150");
  });
});
