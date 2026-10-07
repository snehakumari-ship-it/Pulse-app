import { LedgerEntryReceiptCard } from "@/components/ledger/LedgerEntryReceiptCard";
import type { LedgerEntryReceiptPartyAvatar } from "@/components/ledger/LedgerEntryReceiptCard";
import { LEDGER_RECEIPT } from "@/components/ledger/ledgerEntryReceiptPalette";
import type { LedgerRow } from "@/features/finance/services/finance.service";
import {
  isMarketplacePlatformFeeLedgerRow,
  marketplaceFeeBidIdFromLedgerRow,
} from "@/features/finance/utils/marketplaceFeeLedgerTrip.util";
import {
  enrichLedgerReceiptDetails,
  ledgerReceiptFromRow,
  type LedgerReceiptTripDetailMap,
} from "@/features/finance/utils/ledgerTransactionReceipt.util";
import { findOrgTripForMarketBid } from "@/features/marketplace/services/marketplaceFeeTrip.service";
import { ROUTES } from "@/lib/routes";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

export function LedgerTransactionPreviewModal({
  visible,
  transaction,
  onClose,
  onViewAllOnTrip,
  resolveReceiptPartyAvatar,
  tripDetailsMap,
}: {
  visible: boolean;
  transaction: LedgerRow | null;
  onClose: () => void;
  /** When set, overrides default navigation to trip Finance Hub → Transactions. */
  onViewAllOnTrip?: (tripId: string) => void;
  /** Same resolver as finance list avatars (linked org branding + integration). */
  resolveReceiptPartyAvatar?: (row: LedgerRow) => LedgerEntryReceiptPartyAvatar | undefined;
  /** Preloaded trip context — avoids network fetch on open. */
  tripDetailsMap?: LedgerReceiptTripDetailMap;
}) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === "web" && width >= 768;

  const receipt = useMemo(
    () => (transaction ? ledgerReceiptFromRow(transaction) : null),
    [transaction],
  );

  const feeBidId =
    transaction && !transaction.trip_id && isMarketplacePlatformFeeLedgerRow(transaction)
      ? marketplaceFeeBidIdFromLedgerRow(transaction)
      : null;
  const { data: feeTrip } = useQuery({
    queryKey: ["q", "marketplace-fee-trip", transaction?.organization_id, feeBidId],
    queryFn: async () => {
      const { trip, error } = await findOrgTripForMarketBid(
        transaction!.organization_id,
        feeBidId!,
      );
      if (error) throw error;
      return trip;
    },
    enabled: Boolean(visible && transaction && feeBidId),
  });

  const partyAvatar = useMemo<LedgerEntryReceiptPartyAvatar | undefined>(() => {
    if (!transaction) return undefined;
    const resolved = resolveReceiptPartyAvatar?.(transaction);
    if (resolved) return resolved;
    return receipt?.partyAvatar;
  }, [transaction, resolveReceiptPartyAvatar, receipt?.partyAvatar]);

  const linkedTripId = (transaction?.trip_id ?? feeTrip?.id ?? "").trim() || null;

  const enrichedDetails = useMemo(() => {
    if (!receipt || !transaction) return [];
    const tripId = (transaction.trip_id ?? "").trim();
    const fromMap = tripId ? tripDetailsMap?.[tripId] : undefined;
    const tripDetail = fromMap ??
      (feeTrip
        ? {
            trip_number: feeTrip.trip_number ?? undefined,
            pickup_area: feeTrip.pickup_area,
            drop_location: feeTrip.drop_location,
            pickup_date: feeTrip.pickup_date,
          }
        : undefined);
    return enrichLedgerReceiptDetails(receipt.details, tripDetail);
  }, [receipt, transaction, tripDetailsMap, feeTrip]);

  if (!visible || !transaction || !receipt) return null;

  const showViewTrip = Boolean(linkedTripId);
  const openLinkedTrip = (tripId: string) => {
    if (onViewAllOnTrip && transaction.trip_id) {
      onViewAllOnTrip(tripId);
      return;
    }
    router.push(
      (feeTrip && !transaction.trip_id
        ? ROUTES.tripDetail(tripId)
        : ROUTES.tripDetailFinanceTransactions(tripId)) as never,
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={styles.cardShell}
          // Ensure overlay tap handlers never win when interacting with the card.
          // RN touch bubbling can be inconsistent across web/native.
          onStartShouldSetResponder={() => true}
        >
          <LedgerEntryReceiptCard
            desktop={isDesktop}
            {...(transaction.is_pending_request ? { heroAnimation: false as const } : {})}
            statusLabel={receipt.statusLabel}
            title={receipt.title}
            amount={receipt.amount}
            isIn={receipt.isIn}
            partyAvatar={partyAvatar}
            details={enrichedDetails}
            secondaryAction={
              showViewTrip ? { label: "Close", onPress: onClose } : undefined
            }
            primaryAction={
              showViewTrip && linkedTripId
                ? {
                    label: feeTrip && !transaction.trip_id ? "View trip" : "View all on trip",
                    onPress: () => {
                      onClose();
                      openLinkedTrip(linkedTripId);
                    },
                  }
                : { label: "Done", onPress: onClose }
            }
          />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: LEDGER_RECEIPT.overlay,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  cardShell: {
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
  },
});
