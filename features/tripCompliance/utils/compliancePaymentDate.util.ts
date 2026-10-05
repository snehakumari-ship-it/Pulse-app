/**
 * Transaction date (`transactions.transaction_date`) for Compliance advance /
 * balance payments. Stored as YYYY-MM-DD; Paid at / Txn Date edit this field.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar YYYY-MM-DD from a stored ISO / date string (local day). */
export function toComplianceTransactionDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const head = iso.trim().slice(0, 10);
  if (DATE_RE.test(head)) return head;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeComplianceTransactionDate(raw: string): string {
  return toComplianceTransactionDateInput(raw.trim()) || raw.trim();
}

export function validateComplianceTransactionDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter a transaction date.";
  if (!DATE_RE.test(trimmed)) return "Use a valid date (YYYY-MM-DD).";
  const [y, m, d] = trimmed.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return "Use a valid date.";
  }
  const latest = new Date();
  latest.setHours(23, 59, 59, 999);
  latest.setDate(latest.getDate() + 1);
  if (date.getTime() > latest.getTime()) return "Date can't be more than one day in the future.";
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Display form used in the Advance Processed Txn Date column. */
export function formatComplianceTxnDate(iso: string | null | undefined): string {
  const ymd = toComplianceTransactionDateInput(iso);
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}
