/**
 * Add Trip — fetch clients for the organization (inline search).
 * Reusable for any trip form that needs client selection.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  getClientsByOrganization,
  type ClientRow,
} from '@/features/clients/services/clients.service';
import { manuallySelectableClients } from '@/features/marketplace/utils/marketplaceParty.util';

export function useClientsForTrip(organizationId: string | null) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(() => {
    if (!organizationId) return;
    setLoading(true);
    getClientsByOrganization(organizationId).then(({ clients: list }) => {
      setClients(manuallySelectableClients(list ?? []));
      setLoading(false);
    });
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) {
      setClients([]);
      return;
    }
    refetch();
  }, [organizationId, refetch]);

  return { clients, loading, refetch };
}
