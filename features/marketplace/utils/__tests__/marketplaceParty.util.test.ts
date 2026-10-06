import {
  isMarketplaceOnlyClient,
  isMarketplaceOnlySupplier,
  manuallySelectableClients,
  manuallySelectableSuppliers,
} from "../marketplaceParty.util";

const suppliers = [
  { id: "fee", name: "Pulse Marketplace (fees)", supplier_type: "marketplace" as const },
  { id: "mkt", name: "Bidder Logistics", supplier_type: "marketplace" as const },
  { id: "int", name: "Linked Fleet", supplier_type: "integrated" as const },
  { id: "off", name: "Offline Fleet", supplier_type: "offline" as const },
  { id: "legacy", name: "No type" },
];

const clients = [
  { id: "mkt", phone: "marketplace-6b0c1e2a-0000-4000-8000-000000000001", linked_organization_id: null },
  { id: "promoted", phone: "marketplace-6b0c1e2a-0000-4000-8000-000000000002", linked_organization_id: "org-2" },
  { id: "linked", phone: "linked-org-3", linked_organization_id: "org-3" },
  { id: "offline", phone: "9876543210", linked_organization_id: null },
];

describe("marketplaceParty.util", () => {
  it("treats the fee party and unconnected Marketplace suppliers as Pulse-only", () => {
    expect(suppliers.filter(isMarketplaceOnlySupplier).map((s) => s.id)).toEqual(["fee", "mkt"]);
  });

  it("treats a Marketplace customer as Pulse-only until it is linked", () => {
    expect(clients.filter(isMarketplaceOnlyClient).map((c) => c.id)).toEqual(["mkt"]);
  });

  it("keeps every other party in order for manual pickers", () => {
    expect(manuallySelectableSuppliers(suppliers).map((s) => s.id)).toEqual(["int", "off", "legacy"]);
    expect(manuallySelectableClients(clients).map((c) => c.id)).toEqual(["promoted", "linked", "offline"]);
  });

  it("does not mutate the source lists used for display lookups", () => {
    const s = [...suppliers];
    const c = [...clients];
    manuallySelectableSuppliers(s);
    manuallySelectableClients(c);
    expect(s).toHaveLength(5);
    expect(c).toHaveLength(4);
  });
});
