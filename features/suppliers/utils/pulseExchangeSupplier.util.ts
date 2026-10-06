import type { SupplierRow } from "@/features/suppliers/services/suppliers.service";

/**
 * The org's Pulse Exchange system supplier. `supplier_type = 'marketplace'` is
 * written only by the Pulse Exchange seed (`_ensure_pulse_exchange_party`); the
 * list RPCs don't return `system_party_key`.
 */
export function isPulseExchangeSupplier(supplier: Pick<SupplierRow, "supplier_type">): boolean {
  return supplier.supplier_type === "marketplace";
}

/** Suppliers a user may pick by hand for a trip. Marketplace awards set Pulse Exchange themselves. */
export function manuallySelectableSuppliers<T extends Pick<SupplierRow, "supplier_type">>(suppliers: T[]): T[] {
  return suppliers.filter((s) => !isPulseExchangeSupplier(s));
}
