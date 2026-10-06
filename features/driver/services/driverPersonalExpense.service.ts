/**
 * General (no-trip) driver expenses. Owner-only reference records in
 * `driver_personal_expenses`; never reach any organization's Finance.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "@/lib/supabase";

const LEGACY_STORAGE_KEY = "driver_general_expenses_v1";
const LIST_LIMIT = 100;

export type DriverGeneralExpenseCategory =
  | "fuel"
  | "toll"
  | "parking"
  | "food"
  | "maintenance"
  | "misc";

export type DriverGeneralExpenseNote = {
  id: string;
  category: DriverGeneralExpenseCategory;
  amountInr: number;
  note: string;
  createdAt: string;
};

type PersonalExpenseRow = {
  id: string;
  category: DriverGeneralExpenseCategory;
  amount_inr: number | string;
  note: string | null;
  created_at: string;
};

export const GENERAL_EXPENSE_CATEGORY_OPTIONS: {
  value: DriverGeneralExpenseCategory;
  label: string;
}[] = [
  { value: "fuel", label: "Fuel" },
  { value: "toll", label: "Toll / FASTag" },
  { value: "parking", label: "Parking" },
  { value: "food", label: "Food / stay" },
  { value: "maintenance", label: "Repair" },
  { value: "misc", label: "Other" },
];

const CATEGORY_VALUES = new Set(GENERAL_EXPENSE_CATEGORY_OPTIONS.map((o) => o.value));

export function generalExpenseCategoryLabel(
  category: DriverGeneralExpenseCategory,
): string {
  return (
    GENERAL_EXPENSE_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ??
    "Other"
  );
}

function toNote(row: PersonalExpenseRow): DriverGeneralExpenseNote {
  return {
    id: row.id,
    category: row.category,
    amountInr: Number(row.amount_inr),
    note: row.note ?? "",
    createdAt: row.created_at,
  };
}

/** Moves notes saved by the device-only v1 into the owner's table, then clears them. */
export async function importLegacyDriverGeneralExpenses(): Promise<void> {
  let legacy: DriverGeneralExpenseNote[] = [];
  try {
    const raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as DriverGeneralExpenseNote[];
    legacy = Array.isArray(parsed) ? parsed : [];
  } catch {
    return;
  }
  const rows = legacy
    .filter((n) => Number(n.amountInr) > 0)
    .map((n) => ({
      category: CATEGORY_VALUES.has(n.category) ? n.category : "misc",
      amount_inr: Math.round(Number(n.amountInr)),
      note: (n.note ?? "").trim().slice(0, 500) || null,
      created_at: n.createdAt,
      spent_on: String(n.createdAt ?? "").slice(0, 10) || undefined,
    }));
  if (rows.length > 0) {
    const res = await supabase().from("driver_personal_expenses").insert(rows);
    if (res.error) return;
  }
  await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => undefined);
}

export async function listDriverGeneralExpenses(): Promise<{
  error: Error | null;
  entries: DriverGeneralExpenseNote[];
}> {
  await importLegacyDriverGeneralExpenses();
  const res = await supabase()
    .from("driver_personal_expenses")
    .select("id,category,amount_inr,note,created_at")
    .is("cancelled_at", null)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (res.error) return { error: new Error(res.error.message), entries: [] };
  return { error: null, entries: ((res.data ?? []) as PersonalExpenseRow[]).map(toNote) };
}

export async function saveDriverGeneralExpense(input: {
  category: DriverGeneralExpenseCategory;
  amountInr: number;
  note?: string | null;
}): Promise<{ error: Error | null; entry: DriverGeneralExpenseNote | null }> {
  const amount = Math.round(Number(input.amountInr) || 0);
  if (amount <= 0) {
    return { error: new Error("Enter a valid amount"), entry: null };
  }
  const res = await supabase()
    .from("driver_personal_expenses")
    .insert({
      category: input.category,
      amount_inr: amount,
      note: (input.note ?? "").trim().slice(0, 500) || null,
    })
    .select("id,category,amount_inr,note,created_at")
    .single();
  if (res.error || !res.data) {
    return { error: new Error(res.error?.message ?? "Could not save expense"), entry: null };
  }
  return { error: null, entry: toNote(res.data as PersonalExpenseRow) };
}

export async function cancelDriverGeneralExpense(id: string): Promise<{ error: Error | null }> {
  const res = await supabase()
    .from("driver_personal_expenses")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .is("cancelled_at", null);
  return { error: res.error ? new Error(res.error.message) : null };
}

export function buildGeneralExpenseWhatsAppMessage(input: {
  entry: DriverGeneralExpenseNote;
  driverName?: string | null;
}): string {
  const cat = generalExpenseCategoryLabel(input.entry.category);
  const amt = `₹${input.entry.amountInr.toLocaleString("en-IN")}`;
  const lines = [
    "Personal expense (no trip)",
    input.driverName?.trim() ? `Driver: ${input.driverName.trim()}` : null,
    `Category: ${cat}`,
    `Amount: ${amt}`,
    input.entry.note ? `Note: ${input.entry.note}` : null,
    "Personal record from the Pulse driver app.",
  ].filter(Boolean);
  return lines.join("\n");
}
