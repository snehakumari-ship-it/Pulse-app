import AsyncStorage from "@react-native-async-storage/async-storage";

const mockInsert = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: () => ({ from: (table: string) => mockFrom(table) }),
}));

import {
  buildGeneralExpenseWhatsAppMessage,
  listDriverGeneralExpenses,
  saveDriverGeneralExpense,
} from "../driverPersonalExpense.service";

function listBuilder(rows: unknown[]) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ["select", "is", "order"]) builder[method] = jest.fn(() => builder);
  builder.limit = jest.fn(() => Promise.resolve({ data: rows, error: null }));
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
});

describe("driverPersonalExpense.service", () => {
  it("saves to driver_personal_expenses without any trip or organization", async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: "e1", category: "food", amount_inr: "120.00", note: null, created_at: "2026-10-07T00:00:00Z" },
      error: null,
    });
    mockInsert.mockReturnValue({ select: () => ({ single }) });
    mockFrom.mockReturnValue({ insert: mockInsert });

    const res = await saveDriverGeneralExpense({ category: "food", amountInr: 120, note: "  " });

    expect(mockFrom).toHaveBeenCalledWith("driver_personal_expenses");
    expect(mockInsert).toHaveBeenCalledWith({ category: "food", amount_inr: 120, note: null });
    expect(res.entry).toMatchObject({ id: "e1", amountInr: 120, note: "" });
  });

  it("refuses a non-positive amount without calling the server", async () => {
    const res = await saveDriverGeneralExpense({ category: "misc", amountInr: 0 });
    expect(res.error?.message).toBe("Enter a valid amount");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("imports device-only notes once, then lists from the table", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify([
        { id: "l1", category: "toll", amountInr: 50, note: "plaza", createdAt: "2026-09-01T10:00:00Z" },
        { id: "l2", category: "bogus", amountInr: 0, note: "", createdAt: "2026-09-02T10:00:00Z" },
      ]),
    );
    const insert = jest.fn().mockResolvedValue({ error: null });
    const list = listBuilder([
      { id: "r1", category: "toll", amount_inr: 50, note: "plaza", created_at: "2026-09-01T10:00:00Z" },
    ]);
    mockFrom.mockImplementationOnce(() => ({ insert })).mockImplementationOnce(() => list);

    const res = await listDriverGeneralExpenses();

    expect(insert).toHaveBeenCalledWith([
      { category: "toll", amount_inr: 50, note: "plaza", created_at: "2026-09-01T10:00:00Z", spent_on: "2026-09-01" },
    ]);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("driver_general_expenses_v1");
    expect(list.is).toHaveBeenCalledWith("cancelled_at", null);
    expect(res.entries).toEqual([
      { id: "r1", category: "toll", amountInr: 50, note: "plaza", createdAt: "2026-09-01T10:00:00Z" },
    ]);
  });

  it("keeps device notes when the import fails", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify([{ id: "l1", category: "toll", amountInr: 50, note: "", createdAt: "2026-09-01T10:00:00Z" }]),
    );
    const insert = jest.fn().mockResolvedValue({ error: { message: "offline" } });
    mockFrom.mockImplementationOnce(() => ({ insert })).mockImplementationOnce(() => listBuilder([]));

    await listDriverGeneralExpenses();

    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it("share text is a personal record, not a settlement request", () => {
    const text = buildGeneralExpenseWhatsAppMessage({
      entry: { id: "e1", category: "food", amountInr: 120, note: "", createdAt: "" },
      driverName: "Ravi",
    });
    expect(text).toContain("Personal expense (no trip)");
    expect(text).not.toMatch(/settle|fleet/i);
  });
});
