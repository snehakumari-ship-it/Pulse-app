-- Why a shipper took an indent out of the open pool.
-- "Indent expired" is stored with status expired; the other reasons with status cancelled.

ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.indents
  DROP CONSTRAINT IF EXISTS indents_cancel_reason_check;

ALTER TABLE public.indents
  ADD CONSTRAINT indents_cancel_reason_check
  CHECK (
    cancel_reason IS NULL
    OR cancel_reason IN (
      'cancelled_by_client',
      'indent_expired',
      'no_rates_available',
      'wrong_entry'
    )
  );

COMMENT ON COLUMN public.indents.cancel_reason IS
  'Shipper cancel reason: cancelled_by_client, indent_expired, no_rates_available, wrong_entry.';
