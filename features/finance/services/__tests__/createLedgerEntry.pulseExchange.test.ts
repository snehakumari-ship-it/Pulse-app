import { createLedgerEntry } from "../finance.service";

const mockFrom = jest.fn();
const mockClaim = jest.fn();
const mockIsPx = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: () => ({
    from: mockFrom,
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
  }),
}));

jest.mock("@/features/marketplace/services/exchangePayments.service", () => {
  const actual = jest.requireActual("@/features/marketplace/services/exchangePayments.service");
  return {
    ...actual,
    isPulseExchangeParty: (...args: unknown[]) => mockIsPx(...args),
    claimExchangePaymentOnce: (...args: unknown[]) => mockClaim(...args),
  };
});

jest.mock("@/lib/tripChatInvalidate", () => ({ notifyTripChatMessagesChanged: jest.fn() }));
jest.mock("@/features/trips/services/tripWorkflow.service", () => ({
  recordTripWorkflowEvent: jest.fn().mockResolvedValue({ error: null }),
}));
jest.mock("@/features/drivers/services/drivers.service", () => ({
  getDriverProfileDisplay: jest.fn(),
  getDriverProfileDisplayBatch: jest.fn(),
}));
jest.mock("@/lib/avatarUpload", () => ({
  AVATAR_BUCKET: "avatars",
  LEGACY_AVATAR_BUCKET: "avatars-legacy",
  extractPathFromStorageUrl: jest.fn(),
  getSignedAvatarUrl: jest.fn(),
  resolveAvatarPublicUrl: jest.fn(),
}));

function genericBuilder(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const builder: Record<string, unknown> = {};
  ["select", "eq", "in", "order", "limit", "range", "update", "insert", "neq", "gte", "lte"].forEach((m) => {
    builder[m] = jest.fn(() => builder);
  });
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  builder.single = jest.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const pxSupplierPayment = {
  trip_id: "trip-mkt",
  trip_number: "T-MKT",
  ledgerWritePassthroughTripContext: true,
  contact_type: "supplier",
  contact_id: "px-sup",
  party_name: "Pulse Exchange",
  amount_in: 0,
  amount_out: 4000,
  description: "PAYMENT | Mode: UPI | UTR: UTR77",
  transaction_date: "2026-10-05",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockImplementation(() => genericBuilder());
});

describe("createLedgerEntry — Pulse Exchange party", () => {
  it("records an Exchange claim instead of a ledger row", async () => {
    mockIsPx.mockResolvedValue(true);
    mockClaim.mockResolvedValue({ error: null, payment: { id: "xp-1", status: "claimed" } });

    const result = await createLedgerEntry("org-1", pxSupplierPayment as never);

    expect(result).toEqual({ error: null, row: null, pendingExchangeConfirmation: true });
    expect(mockIsPx).toHaveBeenCalledWith("org-1", "supplier", "px-sup");
    expect(mockClaim).toHaveBeenCalledWith("org-1", {
      tripId: "trip-mkt",
      amount: 4000,
      paymentMode: "UPI",
      paymentReference: "UTR77",
      paidOn: "2026-10-05",
    });
    expect(mockFrom).not.toHaveBeenCalledWith("transactions");
  });

  it("requires the Marketplace trip", async () => {
    mockIsPx.mockResolvedValue(true);

    const result = await createLedgerEntry("org-1", { ...pxSupplierPayment, trip_id: null } as never);

    expect(result.error?.message).toMatch(/Pick the Marketplace trip/);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("transactions");
  });

  it("surfaces an Exchange rejection (e.g. over-settlement) without writing", async () => {
    mockIsPx.mockResolvedValue(true);
    mockClaim.mockResolvedValue({ error: new Error("over the agreed amount"), payment: null });

    const result = await createLedgerEntry("org-1", pxSupplierPayment as never);

    expect(result.error?.message).toBe("over the agreed amount");
    expect(result.pendingExchangeConfirmation).toBeUndefined();
    expect(mockFrom).not.toHaveBeenCalledWith("transactions");
  });

  it("leaves ordinary supplier payments on the normal ledger path", async () => {
    mockIsPx.mockResolvedValue(false);
    mockFrom.mockImplementation((table: string) => {
      if (table !== "transactions") return genericBuilder();
      const inserted = genericBuilder({
        data: { id: "tx-1", ...pxSupplierPayment, contact_id: "sup-1", organization_id: "org-1" },
        error: null,
      });
      const builder = genericBuilder({ data: [], error: null });
      builder.insert = jest.fn(() => inserted);
      return builder;
    });

    const result = await createLedgerEntry("org-1", { ...pxSupplierPayment, contact_id: "sup-1" } as never);

    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith("transactions");
    expect(result.error).toBeNull();
    expect(result.pendingExchangeConfirmation).toBeUndefined();
  });
});
