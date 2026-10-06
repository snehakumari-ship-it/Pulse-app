type SupplierLike = { supplier_type?: string | null };
type ClientLike = { phone?: string | null; linked_organization_id?: string | null };

/**
 * Parties written only by Pulse, mirrored from `get_non_selectable_party_ids`:
 * the "Pulse Marketplace (fees)" supplier and Marketplace accounts for orgs you
 * are not connected to. Both carry `supplier_type = 'marketplace'`; connecting
 * promotes the account to `integrated`. Unconnected Marketplace customers use
 * the placeholder phone `marketplace-<org id>` and have no linked org.
 */
const MARKETPLACE_CLIENT_PHONE_PREFIX = "marketplace-";

export function isMarketplaceOnlySupplier(supplier: SupplierLike): boolean {
  return supplier.supplier_type === "marketplace";
}

export function isMarketplaceOnlyClient(client: ClientLike): boolean {
  return (
    !client.linked_organization_id &&
    String(client.phone ?? "").startsWith(MARKETPLACE_CLIENT_PHONE_PREFIX)
  );
}

/** Suppliers a user may pick by hand. Finance still lists every party. */
export function manuallySelectableSuppliers<T extends SupplierLike>(suppliers: T[]): T[] {
  return suppliers.filter((s) => !isMarketplaceOnlySupplier(s));
}

/** Customers a user may pick by hand. Finance still lists every party. */
export function manuallySelectableClients<T extends ClientLike>(clients: T[]): T[] {
  return clients.filter((c) => !isMarketplaceOnlyClient(c));
}
