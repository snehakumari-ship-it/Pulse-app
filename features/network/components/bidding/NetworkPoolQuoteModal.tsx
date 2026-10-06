/**
 * One quote for a whole Network pool (one canonical lane, any number of
 * shippers). The rate is written as one direct quote per member indent,
 * sequentially; each indent's shipper reviews, counters and awards only the
 * quote on its own indent.
 */
import { IndentBidAmountEntry } from "@/features/indents/components/bidding/IndentBidAmountEntry";
import {
  createDirectQuote,
  type IndentRow,
} from "@/features/indents";
import {
  poolQuoteFailureLines,
  type NetworkLoadPool,
} from "@/features/network/utils/networkLoadPools.util";
import { runPoolBidSubmission } from "@/features/network/utils/pooledOpportunity.util";
import { useInvalidateIndents } from "@/lib/queries";
import { queryKeys } from "@/lib/queryKeys";
import { type QueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function NetworkPoolQuoteModal({
  pool,
  orgId,
  onClose,
  onSuccess,
  queryClient,
  invalidateIndents,
  refetchMyQuotes,
  refetchMarketIndents,
}: {
  pool: NetworkLoadPool<IndentRow> | null;
  orgId: string | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  queryClient: QueryClient;
  invalidateIndents: ReturnType<typeof useInvalidateIndents>;
  refetchMyQuotes: () => void;
  refetchMarketIndents: () => void;
}) {
  const [entryError, setEntryError] = useState<string | undefined>();
  const [succeededCount, setSucceededCount] = useState(0);

  const handleClose = useCallback(() => {
    setEntryError(undefined);
    onClose();
  }, [onClose]);

  const submitPoolQuote = useCallback(
    async (amount: number): Promise<boolean> => {
      if (!orgId || !pool) return false;
      const indentIds = pool.members.map((m) => m.id);
      const result = await runPoolBidSubmission({
        indentIds,
        memberIds: new Set(indentIds),
        submitOne: async (indentId) => {
          const { error } = await createDirectQuote(
            indentId,
            orgId,
            amount,
            null,
            null,
            null,
          );
          return { error };
        },
      });
      if (result.blocked) {
        setEntryError(result.blocked);
        return false;
      }
      if (result.succeeded.length > 0) {
        invalidateIndents(orgId);
        await Promise.allSettled([
          queryClient.invalidateQueries({
            queryKey: [...queryKeys.indents.finite(orgId), "my-direct-quotes"],
          }),
          queryClient.invalidateQueries({ queryKey: ["indents", "quote-counts"] }),
          ...result.succeeded.map((id) =>
            queryClient.invalidateQueries({
              queryKey: ["indents", id, "direct-quotes"],
            }),
          ),
          refetchMyQuotes(),
          refetchMarketIndents(),
        ]);
      }
      if (result.failed.length > 0) {
        const reasons = poolQuoteFailureLines(result.failed).join(" ");
        setEntryError(
          result.succeeded.length > 0
            ? `Quoted ${result.succeeded.length} of ${plural(result.attempted, "load")}. ${reasons}`
            : result.attempted === 1
              ? `Not quoted. ${reasons}`
              : `Not quoted: none of the ${result.attempted} loads took your rate. ${reasons}`,
        );
        return false;
      }
      setSucceededCount(result.succeeded.length);
      return true;
    },
    [
      orgId,
      pool,
      invalidateIndents,
      queryClient,
      refetchMyQuotes,
      refetchMarketIndents,
    ],
  );

  if (!pool) return null;

  const count = pool.members.length;
  const loadsLabel = plural(count, "load");
  const target =
    pool.targetRateMin != null && pool.targetRateMin === pool.targetRateMax
      ? pool.targetRateMin
      : undefined;

  return (
    <IndentBidAmountEntry
      visible
      onClose={handleClose}
      onSubmitAmount={submitPoolQuote}
      onSuccessDone={() =>
        onSuccess(`Quote sent for ${plural(succeededCount, "load")}`)
      }
      indentDisplayNumber={`Pool · ${loadsLabel}`}
      origin={pool.key.pickup}
      destination={pool.key.drop}
      vehicleType={pool.key.vehicleType}
      ownerName="Network pool"
      targetRateInr={target}
      contextLine={`Applies to all ${loadsLabel} in this pool`}
      submitLabel="Quote for pool"
      confirmCopy={{
        scopeNote: `Your rate will be quoted on all ${loadsLabel} in this pool. Each shipper reviews, counters and awards its own load.`,
        successTitle: "Pool quoted",
        successSubtitle: `Your rate has been quoted on all ${loadsLabel}.`,
      }}
      validationError={entryError}
      onClearValidationError={() => setEntryError(undefined)}
      onInvalidAmount={() => setEntryError("Enter an amount greater than 0.")}
    />
  );
}
