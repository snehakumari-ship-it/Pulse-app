import {
  isMarketplacePlatformFeeLedgerRow,
  marketplaceFeeBidIdFromLedgerRow,
  pickOrgTripForMarketBid,
} from "../marketplaceFeeLedgerTrip.util";

describe("marketplaceFeeLedgerTrip.util", () => {
  it("recognizes category, description, and Pulse Marketplace party", () => {
    expect(
      isMarketplacePlatformFeeLedgerRow({
        ledger_category: "MARKETPLACE_PLATFORM_FEE",
        description: "",
        party_name: "Acme",
      }),
    ).toBe(true);
    expect(
      isMarketplacePlatformFeeLedgerRow({
        ledger_category: null,
        description: "MARKETPLACE PLATFORM FEE | Mode: Temporary cash settlement",
        party_name: "Pulse Marketplace",
      }),
    ).toBe(true);
    expect(
      isMarketplacePlatformFeeLedgerRow({
        ledger_category: null,
        description: "Supplier payment",
        party_name: "DEVANATHAN TRANSPORT MANIVANNAN",
      }),
    ).toBe(false);
  });

  it("reads a bid id from payment_ref and ignores UTRs", () => {
    expect(
      marketplaceFeeBidIdFromLedgerRow({
        payment_ref: "cb27ca19-5da0-4650-8906-ce460554c1ff",
      }),
    ).toBe("cb27ca19-5da0-4650-8906-ce460554c1ff");
    expect(marketplaceFeeBidIdFromLedgerRow({ payment_ref: "UTR-SAT812" })).toBeNull();
    expect(marketplaceFeeBidIdFromLedgerRow({ payment_ref: null })).toBeNull();
  });

  it("prefers the bid-stamped trip when several trips share an indent", () => {
    const bidId = "cb27ca19-5da0-4650-8906-ce460554c1ff";
    const chosen = pickOrgTripForMarketBid(
      [
        { id: "newer-indent-sibling", source_market_bid_id: null },
        { id: "award-trip", source_market_bid_id: bidId },
        { id: "older-indent-sibling", source_market_bid_id: "other-bid" },
      ],
      bidId,
    );
    expect(chosen?.id).toBe("award-trip");
  });

  it("returns null when no candidate trips exist", () => {
    expect(pickOrgTripForMarketBid([], "cb27ca19-5da0-4650-8906-ce460554c1ff")).toBeNull();
  });
});
