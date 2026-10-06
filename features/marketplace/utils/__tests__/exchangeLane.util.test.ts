import type { ExchangeLaneTrip, ExchangePaymentRow } from "@/features/marketplace/services/exchangePayments.service";
import { exchangeLaneRows } from "../exchangeLane.util";

const now = new Date("2026-10-06T12:00:00.000Z");

function payment(overrides: Partial<ExchangePaymentRow>): ExchangePaymentRow {
  return {
    id: "xp",
    trip_id: "t",
    market_bid_id: null,
    payer_organization_id: "a",
    payee_organization_id: "b",
    payee_dco_payee_id: null,
    amount: 1000,
    payment_mode: "UPI",
    payment_reference: null,
    paid_on: "2026-10-06",
    notes: null,
    status: "claimed",
    claimed_by_side: "payer",
    claimed_by: null,
    claimed_at: "2026-10-06T10:00:00.000Z",
    decided_by: null,
    decided_at: null,
    decision_reason: null,
    payer_transaction_id: null,
    payee_transaction_id: null,
    ...overrides,
  };
}

function trip(id: string, overrides: Partial<ExchangeLaneTrip>): ExchangeLaneTrip {
  return {
    trip_id: id,
    trip_number: id,
    viewer_side: "payer",
    payee_kind: "organization",
    payer_organization_id: "a",
    payer_organization_name: "Shipper",
    payee_organization_id: "b",
    payee_organization_name: "Bidder",
    agreed_amount: 10000,
    confirmed_amount: 0,
    claimed_amount: 0,
    ledger_contact_type: "supplier",
    ledger_contact_id: "acct",
    payments: [],
    viewer_trip_id: id,
    viewer_trip_number: id,
    ledger_contact_name: "Bidder",
    ...overrides,
  };
}

describe("exchangeLaneRows", () => {
  const trips = [
    trip("settled", { confirmed_amount: 10000 }),
    trip("open", { confirmed_amount: 4000 }),
    trip("theirs", { payments: [payment({ claimed_by_side: "payer" })] }),
    trip("yours", { payments: [payment({ claimed_by_side: "payee", claimed_at: "2026-10-02T00:00:00.000Z" })] }),
    trip("dco", { ledger_contact_type: "dco", ledger_contact_id: null }),
    trip("receivable", { viewer_side: "payee", ledger_contact_type: "client" }),
  ];

  it("shows only the viewer's side, with what is still outstanding and who must act", () => {
    const rows = exchangeLaneRows(trips, "payer", "all", now);
    expect(rows.map((r) => [r.trip.trip_id, r.status, r.outstanding])).toEqual([
      ["settled", "settled", 0],
      ["open", "open", 6000],
      ["theirs", "awaiting_them", 10000],
      ["yours", "awaiting_you", 10000],
      ["dco", "open", 10000],
    ]);
    expect(rows.find((r) => r.trip.trip_id === "yours")?.overdue).toBe(true);
    expect(rows.find((r) => r.trip.trip_id === "theirs")?.overdue).toBe(false);
  });

  it("follows the Suppliers tab's Supplier / DCO chip", () => {
    expect(exchangeLaneRows(trips, "payer", "dco", now).map((r) => r.trip.trip_id)).toEqual(["dco"]);
    expect(exchangeLaneRows(trips, "payer", "supplier", now)).toHaveLength(4);
  });

  it("lists receivables for the bidder", () => {
    expect(exchangeLaneRows(trips, "payee", "all", now).map((r) => r.trip.trip_id)).toEqual(["receivable"]);
  });
});
