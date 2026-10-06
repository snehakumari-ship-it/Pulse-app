/**
 * Full-page bid amount entry (Get Load / Load Center) with the same
 * review → success celebration as story BidSheet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FullscreenNumericEntry,
  parseRawToNumber,
  toRawString,
} from "@/components/mobile-input";
import type { NumericEntryPartyPreview } from "@/components/mobile-input";
import {
  BidConfirmModal,
  type BidConfirmCopy,
  type BidConfirmPhase,
} from "@/features/network/components/bidding/BidConfirmModal";

export interface IndentBidAmountEntryProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Persist the bid. Return true on success — entry shows celebration.
   * Do not close the entry yourself; celebration Done calls onClose.
   */
  onSubmitAmount: (amountInr: number) => Promise<boolean>;
  /** Optional toast / refresh after success celebration dismisses. */
  onSuccessDone?: () => void;
  indentDisplayNumber: string;
  origin?: string | null;
  destination?: string | null;
  /** e.g. Container / Trailer */
  vehicleType?: string | null;
  /** e.g. 30 t / 30000 KG */
  weightLabel?: string | null;
  material?: string | null;
  /** Load owner / client shown on confirm card. */
  ownerName?: string | null;
  targetRateInr?: number;
  /** Pre-fill when updating an existing quote. */
  initialAmount?: number | null;
  isUpdate?: boolean;
  validationError?: string;
  onClearValidationError?: () => void;
  onInvalidAmount?: () => void;
  /** Line under the title, e.g. what the amount applies to. */
  contextLine?: string;
  submitLabel?: string;
  confirmCopy?: BidConfirmCopy;
}

function routeSubtitle(
  origin?: string | null,
  destination?: string | null,
): string | undefined {
  const o = (origin ?? "").trim();
  const d = (destination ?? "").trim();
  if (!o && !d) return undefined;
  if (!o) return d;
  if (!d) return o;
  return `${o} → ${d}`;
}

function cleanSpec(value?: string | null): string | undefined {
  const v = (value ?? "").trim();
  if (!v || v === "—") return undefined;
  return v;
}

export function IndentBidAmountEntry({
  visible,
  onClose,
  onSubmitAmount,
  onSuccessDone,
  indentDisplayNumber,
  origin,
  destination,
  vehicleType,
  weightLabel,
  material,
  ownerName,
  targetRateInr,
  initialAmount,
  isUpdate = false,
  validationError,
  onClearValidationError,
  onInvalidAmount,
  contextLine,
  submitLabel,
  confirmCopy,
}: IndentBidAmountEntryProps) {
  const title = isUpdate ? "Update your bid" : "Place your bid";

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPhase, setConfirmPhase] = useState<BidConfirmPhase>("review");
  const [pendingAmount, setPendingAmount] = useState(0);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const celebrationLockRef = useRef(false);

  useEffect(() => {
    if (visible) return;
    celebrationLockRef.current = false;
    setConfirmOpen(false);
    setConfirmPhase("review");
    setConfirmSubmitting(false);
    setPendingAmount(0);
  }, [visible]);

  const initialValue = useMemo(() => {
    if (initialAmount != null && Number(initialAmount) > 0) {
      return toRawString(initialAmount);
    }
    return "";
  }, [visible, initialAmount]);

  const partyPreview = useMemo((): NumericEntryPartyPreview | undefined => {
    const route = routeSubtitle(origin, destination);
    const specParts = [
      cleanSpec(vehicleType),
      cleanSpec(weightLabel),
      cleanSpec(material),
    ].filter(Boolean) as string[];
    const displayName =
      (ownerName ?? "").trim() || `Indent ${indentDisplayNumber}`;
    return {
      name: displayName,
      heroLine: route,
      detailLine: specParts.length > 0 ? specParts.join(" · ") : undefined,
      subtitle: route,
      entityType: "client",
    };
  }, [
    indentDisplayNumber,
    origin,
    destination,
    vehicleType,
    weightLabel,
    material,
    ownerName,
  ]);

  const originCity = cleanSpec(origin);
  const destinationCity = cleanSpec(destination);
  const vehicle = cleanSpec(vehicleType);
  const weight = cleanSpec(weightLabel);
  const materialClean = cleanSpec(material);
  const owner =
    (ownerName ?? "").trim() ||
    `Indent ${indentDisplayNumber}`;

  const requestConfirm = useCallback(
    (raw: string) => {
      onClearValidationError?.();
      const amount = parseRawToNumber(raw);
      if (!Number.isFinite(amount) || amount <= 0) {
        onInvalidAmount?.();
        return;
      }
      celebrationLockRef.current = true;
      setPendingAmount(amount);
      setConfirmPhase("review");
      setConfirmOpen(true);
    },
    [onClearValidationError, onInvalidAmount],
  );

  const handleConfirm = useCallback(async () => {
    if (confirmSubmitting || pendingAmount <= 0) return;
    setConfirmSubmitting(true);
    onClearValidationError?.();
    try {
      const ok = await onSubmitAmount(pendingAmount);
      if (!ok) {
        celebrationLockRef.current = false;
        setConfirmOpen(false);
        setConfirmPhase("review");
        return;
      }
      celebrationLockRef.current = true;
      setConfirmPhase("success");
    } finally {
      setConfirmSubmitting(false);
    }
  }, [
    confirmSubmitting,
    pendingAmount,
    onClearValidationError,
    onSubmitAmount,
  ]);

  const finishAfterSuccess = useCallback(() => {
    celebrationLockRef.current = false;
    setConfirmOpen(false);
    setConfirmPhase("review");
    setPendingAmount(0);
    onSuccessDone?.();
    onClose();
  }, [onSuccessDone, onClose]);

  const handleCancelConfirm = useCallback(() => {
    if (confirmSubmitting || confirmPhase !== "review") return;
    celebrationLockRef.current = false;
    setConfirmOpen(false);
    setConfirmPhase("review");
  }, [confirmSubmitting, confirmPhase]);

  const handleCloseEntry = useCallback(() => {
    if (confirmSubmitting || celebrationLockRef.current) return;
    onClose();
  }, [confirmSubmitting, onClose]);

  return (
    <>
      <FullscreenNumericEntry
        visible={visible}
        onClose={handleCloseEntry}
        onSubmit={requestConfirm}
        initialValue={initialValue}
        label={title}
        contextLine={contextLine}
        partyPreview={partyPreview}
        type="currency"
        prefix="₹"
        placeholder="0"
        allowDecimal={false}
        maxDecimalPlaces={0}
        submitLabel={submitLabel ?? (isUpdate ? "Update bid" : "Submit bid")}
        validationError={
          confirmSubmitting
            ? isUpdate
              ? "Updating…"
              : "Submitting…"
            : validationError
        }
        targetRate={
          targetRateInr != null && targetRateInr > 0 ? targetRateInr : null
        }
      />

      <BidConfirmModal
        visible={confirmOpen}
        phase={confirmPhase}
        isEditMode={isUpdate}
        amount={pendingAmount}
        ownerName={owner}
        origin={originCity}
        destination={destinationCity}
        vehicle={vehicle}
        weight={weight}
        material={materialClean}
        targetRate={
          targetRateInr != null && targetRateInr > 0 ? targetRateInr : null
        }
        submitting={confirmSubmitting}
        copy={confirmCopy}
        onCancel={handleCancelConfirm}
        onConfirm={() => {
          void handleConfirm();
        }}
        onSuccessDone={finishAfterSuccess}
      />
    </>
  );
}
