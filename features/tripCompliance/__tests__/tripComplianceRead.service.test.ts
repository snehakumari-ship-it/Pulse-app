import {
    advanceFromTripReceipts,
    buildComplianceOutstandingSummary,
    canApproveComplianceWithException,
    canMarkComplianceVerified,
    deriveComplianceStage,
    isAdvancePostedAfterVerification,
    summarizeComplianceTrip,
} from "@/features/tripCompliance/services/tripComplianceRead.service";
import { deriveComplianceQueueReadiness } from "@/features/tripCompliance/utils/complianceReadiness.util";
import type {
    ComplianceDocumentRow,
    ComplianceTripFlags,
    ComplianceTripInputs,
    CompliancePaymentSummary,
} from "@/features/tripCompliance/tripCompliance.types";
import type { TripRow } from "@/features/trips/services/trips.service";

const PAYMENT = {
  amount: 1000,
  paymentMode: "UPI",
  utr: "UTR123",
  paidAt: "2026-09-01",
  actorId: "user-1",
  transactionId: "txn-1",
};

describe("deriveComplianceStage", () => {
  it("is PENDING_FOR_DOCS when no documents exist", () => {
    expect(
      deriveComplianceStage({
        documentCount: 0,
        complianceVerifiedAt: null,
        advance: null,
        tripStatus: "loading",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("pending_for_docs");
  });

  it("is COMPLIANCE_PENDING once docs exist but none are verified", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        complianceVerifiedAt: null,
        advance: null,
        tripStatus: "loading",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("compliance_pending");
  });

  it("never blocks on trip status — a trip already IN_TRANSIT with compliance still pending stays COMPLIANCE_PENDING, not an error state", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        complianceVerifiedAt: null,
        advance: null,
        tripStatus: "in_transit",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("compliance_pending");
  });

  it("is COMPLIANCE_VERIFIED once verified and no advance posted yet", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        complianceVerifiedAt: "2026-09-01T00:00:00Z",
        advance: null,
        tripStatus: "loading",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("compliance_verified");
  });

  it("is AWAITING_POD once advance posted (even if trip is not yet delivered)", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        complianceVerifiedAt: "2026-09-01T00:00:00Z",
        advance: PAYMENT,
        tripStatus: "in_transit",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("hard_copy_pod_received");
  });

  it("moves to PENDING_FOR_DOCS when required vehicle docs are expired (even with advance)", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        missingRequiredCount: 0,
        hasExpiredRequiredVehicleDocs: true,
        complianceVerifiedAt: "2026-09-01T00:00:00Z",
        advance: PAYMENT,
        tripStatus: "completed",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("pending_for_docs");
  });

  it("keeps PAYMENT_SETTLED when balance exists even if vehicle docs expired", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        hasExpiredRequiredVehicleDocs: true,
        complianceVerifiedAt: "2026-09-01T00:00:00Z",
        advance: PAYMENT,
        tripStatus: "completed",
        hardCopyReceived: true,
        balance: PAYMENT,
      }),
    ).toBe("payment_settled");
  });

  it("is AWAITING_POD when Finance already collected amount_paid but docs/verification are incomplete", () => {
    expect(
      deriveComplianceStage({
        documentCount: 0,
        complianceVerifiedAt: null,
        advance: PAYMENT,
        tripStatus: "assigned",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("hard_copy_pod_received");
  });

  it("is HARD_COPY_POD_RECEIVED for completed trips with advance (Ops Delivered status)", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        missingRequiredCount: 0,
        complianceVerifiedAt: null,
        advance: PAYMENT,
        tripStatus: "completed",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("hard_copy_pod_received");
  });

  it("is HARD_COPY_POD_RECEIVED once delivered but hard-copy POD not yet marked received", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        complianceVerifiedAt: "2026-09-01T00:00:00Z",
        advance: PAYMENT,
        tripStatus: "delivered",
        hardCopyReceived: false,
        balance: null,
      }),
    ).toBe("hard_copy_pod_received");
  });

  it("is BALANCE_PENDING once hard-copy POD marked received but no balance posted", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        complianceVerifiedAt: "2026-09-01T00:00:00Z",
        advance: PAYMENT,
        tripStatus: "delivered",
        hardCopyReceived: true,
        balance: null,
      }),
    ).toBe("balance_pending");
  });

  it("is PAYMENT_SETTLED once balance is posted", () => {
    expect(
      deriveComplianceStage({
        documentCount: 3,
        complianceVerifiedAt: "2026-09-01T00:00:00Z",
        advance: PAYMENT,
        tripStatus: "delivered",
        hardCopyReceived: true,
        balance: PAYMENT,
      }),
    ).toBe("payment_settled");
  });
});

describe("advanceFromTripReceipts", () => {
  it("treats trips.amount_paid as an advance signal", () => {
    expect(
      advanceFromTripReceipts({
        id: "trip-1",
        amount_paid: 11000,
        updated_at: "2026-09-21T10:00:00Z",
        created_at: "2026-09-01T00:00:00Z",
      }),
    ).toMatchObject({ amount: 11000, transactionId: "amount-paid:trip-1" });
  });

  it("ignores unpaid trips", () => {
    expect(
      advanceFromTripReceipts({
        id: "trip-1",
        amount_paid: 0,
        updated_at: "2026-09-21T10:00:00Z",
        created_at: "2026-09-01T00:00:00Z",
      }),
    ).toBeNull();
  });
});

describe("isAdvancePostedAfterVerification — an advance only counts once posted at/after compliance verification", () => {
  const VERIFIED_AT = "2026-09-10T12:00:00Z";

  function payment(postedAt: string | null): CompliancePaymentSummary {
    return { ...PAYMENT, postedAt };
  }

  it("advance posted before verification -> NOT posted", () => {
    expect(isAdvancePostedAfterVerification(payment("2026-09-10T11:59:59Z"), VERIFIED_AT)).toBe(false);
  });

  it("advance posted exactly at verification -> posted", () => {
    expect(isAdvancePostedAfterVerification(payment(VERIFIED_AT), VERIFIED_AT)).toBe(true);
  });

  it("advance posted after verification -> posted", () => {
    expect(isAdvancePostedAfterVerification(payment("2026-09-10T12:00:01Z"), VERIFIED_AT)).toBe(true);
  });

  it("no advance -> not posted", () => {
    expect(isAdvancePostedAfterVerification(null, VERIFIED_AT)).toBe(false);
  });

  it("trip never verified -> not posted even with a postedAt timestamp", () => {
    expect(isAdvancePostedAfterVerification(payment("2026-09-10T12:00:00Z"), null)).toBe(false);
  });

  it("advance with no postedAt (legacy row / unknown) -> not posted", () => {
    expect(isAdvancePostedAfterVerification(payment(null), VERIFIED_AT)).toBe(false);
  });
});

describe("summarizeComplianceTrip — advance gating end to end", () => {
  function tripInputs(overrides: {
    complianceVerifiedAt?: string | null;
    taggedAdvance?: CompliancePaymentSummary | null;
    amountPaidReceipt?: number;
  } = {}): ComplianceTripInputs {
    const trip = {
      id: "trip-1",
      status: "in_transit",
      organization_id: "org-1",
      pod_received_at: null,
      amount_paid: overrides.amountPaidReceipt ?? 0,
      updated_at: "2026-09-21T10:00:00Z",
      created_at: "2026-09-01T00:00:00Z",
    } as unknown as TripRow;

    const flags: ComplianceTripFlags | null =
      overrides.complianceVerifiedAt === undefined
        ? null
        : {
            compliance_verified_at: overrides.complianceVerifiedAt,
            compliance_verified_by: overrides.complianceVerifiedAt ? "user-1" : null,
            compliance_decision: overrides.complianceVerifiedAt ? "approved" : null,
            compliance_exception_reason: null,
            compliance_outstanding_summary: null,
            compliance_declined_at: null,
            compliance_declined_by: null,
            compliance_decline_reason: null,
            pod_hard_copy_courier: null,
            pod_hard_copy_awb_number: null,
            pod_hard_copy_received_by: null,
            pod_received_at: null,
          };

    return {
      trip,
      documents: [],
      flags,
      taggedAdvance: overrides.taggedAdvance ?? null,
      balance: null,
      vehicleDocuments: [],
      driverDocuments: [],
      vaultVehicleId: null,
    };
  }

  it("a compliance_advance transaction posted BEFORE verification does not count as the advance", () => {
    const summary = summarizeComplianceTrip(
      tripInputs({
        complianceVerifiedAt: "2026-09-10T12:00:00Z",
        taggedAdvance: { ...PAYMENT, postedAt: "2026-09-05T00:00:00Z" },
      }),
    );
    expect(summary.advance).toBeNull();
    // Stays at Verified — never silently advances to Awaiting POD.
    expect(summary.stage).toBe("compliance_verified");
  });

  it("a compliance_advance transaction posted AFTER verification counts as the advance", () => {
    const summary = summarizeComplianceTrip(
      tripInputs({
        complianceVerifiedAt: "2026-09-10T12:00:00Z",
        taggedAdvance: { ...PAYMENT, postedAt: "2026-09-11T00:00:00Z" },
      }),
    );
    expect(summary.advance).not.toBeNull();
    expect(summary.stage).toBe("hard_copy_pod_received");
  });

  it("a Finance client receipt (trips.amount_paid) never counts as the advance, verified or not", () => {
    const summary = summarizeComplianceTrip(
      tripInputs({ complianceVerifiedAt: "2026-09-10T12:00:00Z", amountPaidReceipt: 11000 }),
    );
    expect(summary.advance).toBeNull();
    expect(summary.stage).toBe("compliance_verified");
  });

  it("no advance at all -> not posted, trip stays wherever doc/verification state puts it", () => {
    const summary = summarizeComplianceTrip(tripInputs({ complianceVerifiedAt: null }));
    expect(summary.advance).toBeNull();
  });

  it("a pre-verification advance cannot unblock Pay: readiness still reports advance as blocked, not posted", () => {
    const summary = summarizeComplianceTrip(
      tripInputs({
        complianceVerifiedAt: null,
        taggedAdvance: { ...PAYMENT, postedAt: "2026-09-05T00:00:00Z" },
      }),
    );
    const readiness = deriveComplianceQueueReadiness(summary);
    expect(readiness.advance.status).not.toBe("posted");
    expect(readiness.advance.status).toBe("blocked");
  });
});

function doc(overrides: Partial<ComplianceDocumentRow>): ComplianceDocumentRow {
  return {
    id: overrides.id ?? "doc-1",
    trip_id: "trip-1",
    document_type: "lr",
    file_name: "f.pdf",
    storage_path: "path",
    uploaded_at: "2026-09-01",
    status: "pending",
    verified_by: null,
    verified_at: null,
    rejection_reason: null,
    ...overrides,
  };
}

describe("canMarkComplianceVerified", () => {
  it("fails when required document types are missing entirely", () => {
    const result = canMarkComplianceVerified([doc({ document_type: "lr", status: "verified" })]);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("invoice");
  });

  it("fails when a required document type exists but isn't verified", () => {
    const result = canMarkComplianceVerified([
      doc({ id: "1", document_type: "lr", status: "verified" }),
      doc({ id: "2", document_type: "invoice", status: "pending" }),
      doc({ id: "3", document_type: "eway_bill", status: "verified" }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["invoice"]);
  });

  it("passes only once LR, e-way bill, and invoice are verified", () => {
    const result = canMarkComplianceVerified([
      doc({ id: "1", document_type: "lr", status: "verified" }),
      doc({ id: "2", document_type: "invoice", status: "verified" }),
      doc({ id: "3", document_type: "eway_bill", status: "verified" }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe("buildComplianceOutstandingSummary", () => {
  it("captures a missing required document (no row at all)", () => {
    const result = buildComplianceOutstandingSummary([
      doc({ id: "1", document_type: "lr", status: "verified" }),
      doc({ id: "2", document_type: "invoice", status: "verified" }),
    ]);
    expect(result.missing).toEqual(["eway_bill"]);
    expect(result.pending_verification).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("captures a pending-verification required document", () => {
    const result = buildComplianceOutstandingSummary([
      doc({ id: "1", document_type: "lr", status: "verified" }),
      doc({ id: "2", document_type: "invoice", status: "pending" }),
      doc({ id: "3", document_type: "eway_bill", status: "verified" }),
    ]);
    expect(result.pending_verification).toEqual(["invoice"]);
    expect(result.missing).toEqual([]);
  });

  it("captures a rejected required document", () => {
    const result = buildComplianceOutstandingSummary([
      doc({ id: "1", document_type: "lr", status: "verified" }),
      doc({ id: "2", document_type: "invoice", status: "rejected" }),
      doc({ id: "3", document_type: "eway_bill", status: "verified" }),
    ]);
    expect(result.rejected).toEqual(["invoice"]);
  });

  it("is empty once every required type is verified", () => {
    const result = buildComplianceOutstandingSummary([
      doc({ id: "1", document_type: "lr", status: "verified" }),
      doc({ id: "2", document_type: "invoice", status: "verified" }),
      doc({ id: "3", document_type: "eway_bill", status: "verified" }),
    ]);
    expect(result).toEqual({ missing: [], pending_verification: [], rejected: [] });
  });
});

describe("canApproveComplianceWithException", () => {
  it("is eligible when the trip has outstanding required docs and hasn't been decided", () => {
    const result = canApproveComplianceWithException({
      documents: [doc({ id: "1", document_type: "lr", status: "verified" })],
      complianceVerifiedAt: null,
    });
    expect(result.ok).toBe(true);
    expect(result.outstanding.missing).toEqual(expect.arrayContaining(["invoice", "eway_bill"]));
  });

  it("is not eligible once every required doc is verified — normal approval applies instead", () => {
    const result = canApproveComplianceWithException({
      documents: [
        doc({ id: "1", document_type: "lr", status: "verified" }),
        doc({ id: "2", document_type: "invoice", status: "verified" }),
        doc({ id: "3", document_type: "eway_bill", status: "verified" }),
      ],
      complianceVerifiedAt: null,
    });
    expect(result.ok).toBe(false);
  });

  it("is not eligible once the trip already has a compliance decision", () => {
    const result = canApproveComplianceWithException({
      documents: [doc({ id: "1", document_type: "lr", status: "verified" })],
      complianceVerifiedAt: "2026-09-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
  });
});
