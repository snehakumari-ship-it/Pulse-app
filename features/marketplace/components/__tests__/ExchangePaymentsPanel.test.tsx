import { fireEvent, render } from "@testing-library/react-native";
import { ExchangePaymentsPanel } from "../ExchangePaymentsPanel";
import type { ExchangeTripSummary } from "@/features/marketplace/services/exchangePayments.service";

jest.mock("react-native", () => jest.requireActual("react-native"));

jest.mock("react-native", () => jest.requireActual("react-native"));

const mockMutate = jest.fn();
let mockSummary: ExchangeTripSummary | null = null;

jest.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: () => ({ currentOrganization: { id: "org-payee" } }),
}));

jest.mock("@/features/marketplace/hooks/useExchangeTripPayments", () => ({
  useExchangeTripSummaryQuery: () => ({ data: mockSummary, isLoading: false }),
  useExchangeTripPaymentAction: () => ({ mutate: mockMutate, isPending: false }),
}));

jest.mock("@/lib/appAlert", () => ({ showAppAlert: jest.fn() }));

const payment = {
  id: "xp-1",
  trip_id: "trip-1",
  market_bid_id: "bid-1",
  payer_organization_id: "org-payer",
  payee_organization_id: "org-payee",
  payee_dco_payee_id: null,
  amount: 3000,
  payment_mode: "UPI" as const,
  payment_reference: "UTR1",
  paid_on: "2026-10-05",
  notes: null,
  status: "claimed" as const,
  claimed_by_side: "payer" as const,
  claimed_by: "u-1",
  claimed_at: new Date().toISOString(),
  decided_by: null,
  decided_at: null,
  decision_reason: null,
  payer_transaction_id: null,
  payee_transaction_id: null,
};

function summary(overrides: Partial<ExchangeTripSummary> = {}): ExchangeTripSummary {
  return {
    trip_id: "trip-1",
    trip_number: "T-1",
    viewer_side: "payee",
    payee_kind: "organization",
    payer_organization_id: "org-payer",
    payer_organization_name: "Shipper Co",
    payee_organization_id: "org-payee",
    payee_organization_name: "Bidder Co",
    agreed_amount: 10000,
    confirmed_amount: 0,
    claimed_amount: 3000,
    payments: [payment],
    ...overrides,
  };
}

beforeEach(() => {
  mockMutate.mockReset();
  mockSummary = null;
});

describe("ExchangePaymentsPanel", () => {
  it("renders nothing for trips not settled through Pulse Exchange", () => {
    const { queryByTestId } = render(<ExchangePaymentsPanel tripId="trip-own" />);
    expect(queryByTestId("exchange-payments-panel")).toBeNull();
  });

  it("lets the other side confirm or reject a claim", () => {
    mockSummary = summary();
    const { getByText, queryByText } = render(<ExchangePaymentsPanel tripId="trip-1" />);

    expect(getByText("Awaiting your confirmation")).toBeTruthy();
    expect(queryByText("Withdraw")).toBeNull();

    fireEvent.press(getByText("Confirm"));
    expect(mockMutate).toHaveBeenCalledWith({ kind: "confirm", paymentId: "xp-1" }, expect.any(Object));
  });

  it("shows a DCO payee the same record, without Finance wording", () => {
    mockSummary = summary({
      payee_kind: "dco",
      payee_organization_id: null,
      payee_organization_name: "Ravi DCO",
      confirmed_amount: 3000,
      claimed_amount: 0,
      payments: [{ ...payment, payee_organization_id: null, payee_dco_payee_id: "dco-1", status: "confirmed" }],
    });
    const { getByText, queryByText } = render(<ExchangePaymentsPanel tripId="trip-1" />);

    expect(getByText("Marketplace settlement from Shipper Co")).toBeTruthy();
    expect(getByText("Confirmed · received")).toBeTruthy();
    expect(queryByText("Confirmed · posted to Finance")).toBeNull();
  });

  it("requires a reason to reject", () => {
    mockSummary = summary();
    const { getByText, getByPlaceholderText } = render(<ExchangePaymentsPanel tripId="trip-1" />);

    fireEvent.press(getByText("Reject"));
    fireEvent.press(getByText("Reject payment"));
    expect(mockMutate).not.toHaveBeenCalled();

    fireEvent.changeText(getByPlaceholderText("Reason (e.g. not received)"), "not received");
    fireEvent.press(getByText("Reject payment"));
    expect(mockMutate).toHaveBeenCalledWith(
      { kind: "reject", paymentId: "xp-1", reason: "not received" },
      expect.any(Object),
    );
  });

  it("lets the claimant withdraw but not confirm its own claim", () => {
    mockSummary = summary({ viewer_side: "payer" });
    const { getByText, queryByText } = render(<ExchangePaymentsPanel tripId="trip-1" />);

    expect(getByText("Awaiting their confirmation")).toBeTruthy();
    expect(queryByText("Confirm")).toBeNull();
    fireEvent.press(getByText("Withdraw"));
    expect(mockMutate).toHaveBeenCalledWith({ kind: "cancel", paymentId: "xp-1" }, expect.any(Object));
  });

  it("records a payment with one idempotency key across retries", () => {
    mockSummary = summary({ viewer_side: "payer", payments: [], claimed_amount: 0 });
    const { getByText, getAllByText, getByLabelText, getByPlaceholderText } = render(
      <ExchangePaymentsPanel tripId="trip-1" />,
    );

    fireEvent.press(getByText("Record payment made"));
    fireEvent.changeText(getByLabelText("Amount"), "2,500");
    fireEvent.press(getByText("Bank"));
    fireEvent.changeText(getByPlaceholderText("UTR / reference"), "UTR9");
    const submit = getAllByText("Record payment made")[0];
    fireEvent.press(submit);
    fireEvent.press(submit);

    expect(mockMutate).toHaveBeenCalledTimes(2);
    const [first] = mockMutate.mock.calls[0];
    const [second] = mockMutate.mock.calls[1];
    expect(first).toMatchObject({
      kind: "claim",
      input: { amount: 2500, paymentMode: "BANK", paymentReference: "UTR9" },
    });
    expect(first.input.idempotencyKey).toBeTruthy();
    expect(second.input.idempotencyKey).toBe(first.input.idempotencyKey);
  });

  it("blocks recording more than the unclaimed balance", () => {
    mockSummary = summary({ viewer_side: "payer", payments: [], claimed_amount: 0, agreed_amount: 1000 });
    const { getByText, getAllByText, getByLabelText } = render(<ExchangePaymentsPanel tripId="trip-1" />);

    fireEvent.press(getByText("Record payment made"));
    fireEvent.changeText(getByLabelText("Amount"), "1500");
    fireEvent.press(getAllByText("Record payment made")[0]);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
