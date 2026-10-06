/**
 * Regression for nihas/V1.0.12: switching the Trip/Vehicle/Driver document
 * tab used to clear every in-flight optimistic approve/decline, because
 * `ComplianceDocumentWorkspace`'s `localDecisionByKey` was keyed by a bare
 * document-type string (e.g. "other") that can repeat across tabs, and the
 * state reset on every tab change. `scopedDecisionKey` namespaces the key by
 * tab so a decision on one tab is isolated from another tab's same-named
 * row, and the component no longer needs to wipe the map on a tab switch —
 * only on a trip switch.
 */
import { scopedDecisionKey } from "@/features/tripCompliance/utils/complianceOptimisticDecisionKey.util";

describe("scopedDecisionKey — tab-scoped optimistic decision state", () => {
  it("the same row key on different tabs produces different, non-colliding keys", () => {
    const tripKey = scopedDecisionKey("trip", "other");
    const vehicleKey = scopedDecisionKey("vehicle", "other");
    const driverKey = scopedDecisionKey("driver", "other");
    expect(new Set([tripKey, vehicleKey, driverKey]).size).toBe(3);
  });

  it("the same tab + row key is stable, so an optimistic decision survives switching away and back", () => {
    const first = scopedDecisionKey("trip", "lr");
    const second = scopedDecisionKey("trip", "lr");
    expect(first).toBe(second);
  });

  it("a decision recorded while on the Vehicle tab is not visible under the Trip tab's same-named row", () => {
    const vehicleEntry = scopedDecisionKey("vehicle", "rc");
    const tripEntryWithSameType = scopedDecisionKey("trip", "rc");
    expect(vehicleEntry).not.toBe(tripEntryWithSameType);
  });
});
