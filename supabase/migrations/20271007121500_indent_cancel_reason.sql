-- Widen the existing indent cancel-reason check so the hub can store
-- "No rates available" and "Wrong entry". The column and the older values
-- (client_cancelled, indent_expired, cost_does_not_match) are already live.

ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.indents
  DROP CONSTRAINT IF EXISTS indents_cancel_reason_check;

ALTER TABLE public.indents
  ADD CONSTRAINT indents_cancel_reason_check
  CHECK (
    cancel_reason IS NULL
    OR cancel_reason IN (
      'client_cancelled',
      'indent_expired',
      'no_rates_available',
      'wrong_entry',
      'cost_does_not_match'
    )
  );

COMMENT ON COLUMN public.indents.cancel_reason IS
  'Shipper cancel reason: client_cancelled, indent_expired, no_rates_available, wrong_entry. cost_does_not_match is a legacy value.';
