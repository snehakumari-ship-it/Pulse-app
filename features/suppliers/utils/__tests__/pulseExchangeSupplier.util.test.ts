import { isPulseExchangeSupplier, manuallySelectableSuppliers } from "../pulseExchangeSupplier.util";

const rows = [
  { id: "px", name: "Pulse Exchange", supplier_type: "marketplace" as const },
  { id: "int", name: "Linked Fleet", supplier_type: "integrated" as const },
  { id: "off", name: "Offline Fleet", supplier_type: "offline" as const },
  { id: "legacy", name: "No type" },
];

describe("pulseExchangeSupplier.util", () => {
  it("identifies only the Pulse Exchange system supplier", () => {
    expect(rows.filter(isPulseExchangeSupplier).map((r) => r.id)).toEqual(["px"]);
  });

  it("drops Pulse Exchange from manual pickers and keeps every other supplier in order", () => {
    expect(manuallySelectableSuppliers(rows).map((r) => r.id)).toEqual(["int", "off", "legacy"]);
  });

  it("does not mutate the source list used for display lookups", () => {
    const source = [...rows];
    manuallySelectableSuppliers(source);
    expect(source).toHaveLength(4);
  });
});
