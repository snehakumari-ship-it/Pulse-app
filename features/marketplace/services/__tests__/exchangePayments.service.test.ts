import {
  claimExchangePayment,
  claimExchangePaymentOnce,
  confirmExchangePayment,
  ensurePulseExchangeParties,
  exchangeErrorMessage,
  exchangeModeFromLedgerLabel,
  getExchangeTripSummary,
  isExchangeClaimOverdue,
  isPulseExchangeParty,
  rejectExchangePayment,
} from "../exchangePayments.service";

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));

beforeEach(() => {
  mockRpc.mockReset();
});

describe("exchangeErrorMessage", () => {
  it("maps DB error codes to user copy", () => {
    expect(exchangeErrorMessage("over_settlement: claimed 9000 > agreed 8000")).toMatch(/past the agreed amount/);
    expect(exchangeErrorMessage("duplicate_reference: UTR123")).toMatch(/already recorded/);
    expect(exchangeErrorMessage("exchange_ledger_locked: supplier")).toMatch(/only after the other side confirms/);
  });

  it("strips an unknown code prefix and keeps the message", () => {
    expect(exchangeErrorMessage("forbidden: not a member")).toBe("not a member");
    expect(exchangeErrorMessage("plain failure")).toBe("plain failure");
  });
});

describe("exchangeModeFromLedgerLabel", () => {
  it.each([
    ["UPI", "UPI"],
    ["Cheque", "CHEQUE"],
    ["Bank Transfer", "BANK"],
    ["NEFT", "BANK"],
    ["Cash", "CASH"],
    [null, "CASH"],
  ])("%s → %s", (label, mode) => {
    expect(exchangeModeFromLedgerLabel(label)).toBe(mode);
  });
});

describe("isExchangeClaimOverdue", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("flags a claim waiting more than 72 hours", () => {
    expect(isExchangeClaimOverdue({ status: "claimed", claimed_at: "2026-10-03T11:00:00.000Z" }, now)).toBe(true);
    expect(isExchangeClaimOverdue({ status: "claimed", claimed_at: "2026-10-03T13:00:00.000Z" }, now)).toBe(false);
  });

  it("never flags decided payments", () => {
    expect(isExchangeClaimOverdue({ status: "confirmed", claimed_at: "2026-09-01T00:00:00.000Z" }, now)).toBe(false);
    expect(isExchangeClaimOverdue({ status: "rejected", claimed_at: "2026-09-01T00:00:00.000Z" }, now)).toBe(false);
  });
});

describe("ensurePulseExchangeParties", () => {
  it("returns the org's parties and caches them per org", async () => {
    mockRpc.mockResolvedValue({ data: { supplier_id: "px-sup", client_id: "px-cli" }, error: null });

    await expect(ensurePulseExchangeParties("org-cache")).resolves.toEqual({
      supplierId: "px-sup",
      clientId: "px-cli",
    });
    await ensurePulseExchangeParties("org-cache");

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("ensure_pulse_exchange_parties", { p_org_id: "org-cache" });
  });

  it("does not cache a failure, so the next call retries", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } })
      .mockResolvedValueOnce({ data: { supplier_id: "s", client_id: "c" }, error: null });

    await expect(ensurePulseExchangeParties("org-retry")).resolves.toBeNull();
    await Promise.resolve();
    await expect(ensurePulseExchangeParties("org-retry")).resolves.toEqual({ supplierId: "s", clientId: "c" });
  });

  it("treats a thrown lookup as no party", async () => {
    mockRpc.mockImplementation(() => {
      throw new Error("network down");
    });
    await expect(ensurePulseExchangeParties("org-throw")).resolves.toBeNull();
  });
});

describe("isPulseExchangeParty", () => {
  it("matches only the org's own PX supplier / client", async () => {
    mockRpc.mockResolvedValue({ data: { supplier_id: "px-sup", client_id: "px-cli" }, error: null });

    await expect(isPulseExchangeParty("org-px", "supplier", "px-sup")).resolves.toBe(true);
    await expect(isPulseExchangeParty("org-px", "client", "px-cli")).resolves.toBe(true);
    await expect(isPulseExchangeParty("org-px", "supplier", "px-cli")).resolves.toBe(false);
    await expect(isPulseExchangeParty("org-px", "client", "other")).resolves.toBe(false);
  });

  it("skips the lookup for drivers, vehicles and empty contacts", async () => {
    await expect(isPulseExchangeParty("org-x", "driver", "d1")).resolves.toBe(false);
    await expect(isPulseExchangeParty("org-x", "supplier", null)).resolves.toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("Exchange RPC wrappers", () => {
  it("claim sends trimmed, nullable fields", async () => {
    mockRpc.mockResolvedValue({ data: { id: "xp-1", status: "claimed" }, error: null });

    const { error, payment } = await claimExchangePayment({
      tripId: "trip-1",
      amount: 2500,
      paymentMode: "UPI",
      idempotencyKey: "k-1",
      paymentReference: "  UTR9  ",
      paidOn: "2026-10-05T10:00:00Z",
      notes: "   ",
    });

    expect(error).toBeNull();
    expect(payment?.id).toBe("xp-1");
    expect(mockRpc).toHaveBeenCalledWith("claim_exchange_payment", {
      p_trip_id: "trip-1",
      p_amount: 2500,
      p_payment_mode: "UPI",
      p_idempotency_key: "k-1",
      p_payment_reference: "UTR9",
      p_paid_on: "2026-10-05",
      p_notes: null,
    });
  });

  it("decision calls map DB errors to user copy", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "over_settlement: 9000 > 8000" } });
    const { error } = await confirmExchangePayment("xp-1");
    expect(error?.message).toMatch(/past the agreed amount/);
    expect(mockRpc).toHaveBeenCalledWith("confirm_exchange_payment", { p_exchange_payment_id: "xp-1" });
  });

  it("reject passes the reason", async () => {
    mockRpc.mockResolvedValue({ data: { id: "xp-1", status: "rejected" }, error: null });
    await rejectExchangePayment("xp-1", "not received");
    expect(mockRpc).toHaveBeenCalledWith("reject_exchange_payment", {
      p_exchange_payment_id: "xp-1",
      p_reason: "not received",
    });
  });

  it("claimExchangePaymentOnce reuses one key until the claim succeeds", async () => {
    const input = { tripId: "trip-1", amount: 1200, paymentMode: "UPI" as const, paymentReference: "UTR5", paidOn: "2026-10-05" };
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: "network timeout" } })
      .mockResolvedValueOnce({ data: { id: "xp-9", status: "claimed" }, error: null })
      .mockResolvedValueOnce({ data: { id: "xp-10", status: "claimed" }, error: null });

    await claimExchangePaymentOnce("org-1", input);
    await claimExchangePaymentOnce("org-1", { ...input, paymentReference: " utr5 " });
    await claimExchangePaymentOnce("org-1", input);

    const keys = mockRpc.mock.calls.map(([, args]) => (args as { p_idempotency_key: string }).p_idempotency_key);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("claimExchangePaymentOnce shares the key between concurrent submits", async () => {
    mockRpc.mockResolvedValue({ data: { id: "xp-11", status: "claimed" }, error: null });
    const input = { tripId: "trip-2", amount: 500, paymentMode: "CASH" as const, paidOn: "2026-10-05" };

    await Promise.all([claimExchangePaymentOnce("org-1", input), claimExchangePaymentOnce("org-1", input)]);

    const keys = mockRpc.mock.calls.map(([, args]) => (args as { p_idempotency_key: string }).p_idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("claimExchangePaymentOnce gives different payments different keys", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "network timeout" } });
    const base = { tripId: "trip-3", amount: 500, paymentMode: "CASH" as const, paidOn: "2026-10-05" };

    await claimExchangePaymentOnce("org-1", base);
    await claimExchangePaymentOnce("org-1", { ...base, amount: 600 });

    const keys = mockRpc.mock.calls.map(([, args]) => (args as { p_idempotency_key: string }).p_idempotency_key);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("summary is null for non-Exchange trips", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(getExchangeTripSummary("trip-own")).resolves.toEqual({ error: null, summary: null });
  });
});
