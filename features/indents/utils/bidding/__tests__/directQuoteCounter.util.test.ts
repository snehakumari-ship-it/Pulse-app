import {
  applyAcceptedCounter,
  directQuoteCounterState,
  openCounterAmount,
  routeDirectQuoteSubmit,
  withOpenCounterOnly,
} from "@/features/indents/utils/bidding/directQuoteCounter.util";

const quote = (over: Record<string, unknown> = {}) => ({
  id: "q-1",
  status: "pending",
  amount: 19500,
  counter_amount: 20500 as number | string | null,
  ...over,
});

describe("directQuoteCounterState", () => {
  it("is open while the pending amount differs from the counter", () => {
    expect(directQuoteCounterState(quote())).toBe("open");
    expect(openCounterAmount(quote())).toBe(20500);
  });

  it("is taken once accept_direct_quote_counter set amount = counter (status stays pending)", () => {
    const accepted = quote({ amount: 20500 });
    expect(directQuoteCounterState(accepted)).toBe("taken");
    expect(openCounterAmount(accepted)).toBeNull();
  });

  it("compares numeric strings from PostgREST by value", () => {
    expect(directQuoteCounterState(quote({ amount: "20500.00", counter_amount: "20500" }))).toBe(
      "taken",
    );
  });

  it("is none with no counter, or once the quote is decided", () => {
    expect(directQuoteCounterState(quote({ counter_amount: null }))).toBe("none");
    expect(directQuoteCounterState(quote({ counter_amount: 0 }))).toBe("none");
    expect(directQuoteCounterState(quote({ status: "accepted" }))).toBe("none");
    expect(directQuoteCounterState(quote({ status: "rejected" }))).toBe("none");
    expect(directQuoteCounterState(null)).toBe("none");
  });
});

describe("withOpenCounterOnly", () => {
  it("drops a taken counter from display rows and keeps an open one", () => {
    expect(withOpenCounterOnly(quote({ amount: 20500 })).counter_amount).toBeNull();
    expect(withOpenCounterOnly(quote()).counter_amount).toBe(20500);
  });
});

describe("routeDirectQuoteSubmit", () => {
  it("accepting the exact open counter goes to accept_direct_quote_counter", () => {
    expect(routeDirectQuoteSubmit(quote(), 20500)).toEqual({
      kind: "accept_counter",
      quoteId: "q-1",
      counterAmount: 20500,
    });
  });

  it("any other amount on a countered quote is blocked before any write", () => {
    const route = routeDirectQuoteSubmit(quote(), 19000);
    expect(route.kind).toBe("blocked");
    expect(route.kind === "blocked" && route.message).toMatch(/countered at ₹ ?20,500/);
  });

  it("a taken counter blocks every further change", () => {
    const route = routeDirectQuoteSubmit(quote({ amount: 20500 }), 20500);
    expect(route.kind).toBe("blocked");
    expect(route.kind === "blocked" && route.message).toMatch(/accepted the ₹ ?20,500 counter/);
  });

  it("uncountered or new quotes go to the regular quote write", () => {
    expect(routeDirectQuoteSubmit(quote({ counter_amount: null }), 21000)).toEqual({
      kind: "quote",
    });
    expect(routeDirectQuoteSubmit(null, 21000)).toEqual({ kind: "quote" });
  });
});

describe("applyAcceptedCounter", () => {
  it("patches only the accepted row's amount, leaving status and counter", () => {
    const rows = [quote(), quote({ id: "q-2", amount: 18000, counter_amount: null })];
    const next = applyAcceptedCounter(rows, "q-1", 20500, "2026-10-09T00:00:00Z")!;
    expect(next[0]).toMatchObject({
      id: "q-1",
      amount: 20500,
      counter_amount: 20500,
      status: "pending",
      updated_at: "2026-10-09T00:00:00Z",
    });
    expect(directQuoteCounterState(next[0])).toBe("taken");
    expect(next[1]).toBe(rows[1]);
    expect(applyAcceptedCounter(undefined, "q-1", 20500)).toBeUndefined();
  });
});
