-- Compliance advance/balance: also book supplier Cash OUT (AP) so partner
-- Finance · Statement shows the payment Ops credits to the supplier.
--
-- Complements client-only compliance_advance / compliance_balance rows.
-- Distinct ledger_category values avoid colliding with
-- ux_transactions_compliance_trip_category (one client compliance_* per trip).
--
-- Addresses review on sneha/V1.0.6 Part B:
--   - unique index for supplier categories (no double-tap duplicates)
--   - RLS finance-surface + prerequisite policies cover the new categories
--   - atomic RPC writes client + supplier rows in one transaction
--   - one-time backfill of real supplier rows from existing client posts
--     (statement reads contact-scoped ledger only — no projected fake Out)

-- ── 1. Duplicate protection for supplier mirror categories ───────────────────
create unique index if not exists ux_transactions_compliance_supplier_trip_category
  on public.transactions (trip_id, ledger_category)
  where trip_id is not null
    and ledger_category in ('compliance_supplier_advance', 'compliance_supplier_balance');

comment on index public.ux_transactions_compliance_supplier_trip_category is
  'At most one compliance_supplier_advance and one compliance_supplier_balance per trip.';

-- ── 2. Extend Phase 3 finance-surface RESTRICTIVE policies ──────────────────
-- Drop + recreate so the WITH CHECK / USING lists include supplier categories.
-- Pure pass-through for every other ledger_category (unchanged).

drop policy if exists "compliance_transactions_insert_requires_finance_surface"
  on public.transactions;
drop policy if exists "compliance_transactions_update_requires_finance_surface"
  on public.transactions;

create policy "compliance_transactions_insert_requires_finance_surface"
  on public.transactions
  as restrictive
  for insert
  to authenticated
  with check (
    (ledger_category is distinct from 'compliance_advance'
      and ledger_category is distinct from 'compliance_balance'
      and ledger_category is distinct from 'compliance_supplier_advance'
      and ledger_category is distinct from 'compliance_supplier_balance')
    or public.has_member_surface(organization_id, 'trip_compliance.finance.manage')
  );

create policy "compliance_transactions_update_requires_finance_surface"
  on public.transactions
  as restrictive
  for update
  to authenticated
  using (
    (ledger_category is distinct from 'compliance_advance'
      and ledger_category is distinct from 'compliance_balance'
      and ledger_category is distinct from 'compliance_supplier_advance'
      and ledger_category is distinct from 'compliance_supplier_balance')
    or public.has_member_surface(organization_id, 'trip_compliance.finance.manage')
  )
  with check (
    (ledger_category is distinct from 'compliance_advance'
      and ledger_category is distinct from 'compliance_balance'
      and ledger_category is distinct from 'compliance_supplier_advance'
      and ledger_category is distinct from 'compliance_supplier_balance')
    or public.has_member_surface(organization_id, 'trip_compliance.finance.manage')
  );

-- ── 3. Prerequisites for supplier categories (mirror client rules) ──────────
create policy "compliance_supplier_advance_requires_compliance_approved"
  on public.transactions
  as restrictive
  for insert
  to authenticated
  with check (
    ledger_category is distinct from 'compliance_supplier_advance'
    or exists (
      select 1 from public.trips t
       where t.id = transactions.trip_id
         and t.compliance_verified_at is not null
    )
  );

create policy "compliance_supplier_advance_requires_compliance_approved_on_update"
  on public.transactions
  as restrictive
  for update
  to authenticated
  using (
    ledger_category is distinct from 'compliance_supplier_advance'
    or exists (
      select 1 from public.trips t
       where t.id = transactions.trip_id
         and t.compliance_verified_at is not null
    )
  )
  with check (
    ledger_category is distinct from 'compliance_supplier_advance'
    or exists (
      select 1 from public.trips t
       where t.id = transactions.trip_id
         and t.compliance_verified_at is not null
    )
  );

create policy "compliance_supplier_balance_requires_pod_received"
  on public.transactions
  as restrictive
  for insert
  to authenticated
  with check (
    ledger_category is distinct from 'compliance_supplier_balance'
    or exists (
      select 1 from public.trips t
       where t.id = transactions.trip_id
         and t.pod_received_at is not null
    )
  );

create policy "compliance_supplier_balance_requires_pod_received_on_update"
  on public.transactions
  as restrictive
  for update
  to authenticated
  using (
    ledger_category is distinct from 'compliance_supplier_balance'
    or exists (
      select 1 from public.trips t
       where t.id = transactions.trip_id
         and t.pod_received_at is not null
    )
  )
  with check (
    ledger_category is distinct from 'compliance_supplier_balance'
    or exists (
      select 1 from public.trips t
       where t.id = transactions.trip_id
         and t.pod_received_at is not null
    )
  );

-- ── 4. Atomic dual post (client Cash IN + optional supplier Cash OUT) ───────
-- SECURITY INVOKER so existing RESTRICTIVE RLS still applies. Callers must
-- hold trip_compliance.finance.manage and trip must pass prerequisites.

create or replace function public.post_compliance_settlement_pair(
  p_organization_id uuid,
  p_trip_id uuid,
  p_client_category text,
  p_amount numeric,
  p_description text,
  p_transaction_date date,
  p_payment_reference text,
  p_client_contact_id uuid,
  p_client_party_name text,
  p_supplier_contact_id uuid default null,
  p_supplier_party_name text default null,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_supplier_category text;
  v_client_id uuid;
  v_supplier_id uuid;
  v_existing_client uuid;
  v_existing_supplier uuid;
begin
  if p_client_category is distinct from 'compliance_advance'
     and p_client_category is distinct from 'compliance_balance' then
    raise exception 'invalid client category: %', p_client_category
      using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive'
      using errcode = '22023';
  end if;

  v_supplier_category := case p_client_category
    when 'compliance_advance' then 'compliance_supplier_advance'
    else 'compliance_supplier_balance'
  end;

  select id into v_existing_client
    from public.transactions
   where trip_id = p_trip_id
     and ledger_category = p_client_category
   limit 1;

  if p_supplier_contact_id is not null then
    select id into v_existing_supplier
      from public.transactions
     where trip_id = p_trip_id
       and ledger_category = v_supplier_category
     limit 1;
  end if;

  -- Both legs already present → idempotent no-op for callers.
  if v_existing_client is not null
     and (p_supplier_contact_id is null or v_existing_supplier is not null) then
    return jsonb_build_object(
      'client_transaction_id', v_existing_client,
      'supplier_transaction_id', v_existing_supplier,
      'created_client', false,
      'created_supplier', false,
      'already_posted', true
    );
  end if;

  if v_existing_client is null then
    insert into public.transactions (
      organization_id,
      trip_id,
      party_name,
      description,
      amount_in,
      amount_out,
      transaction_date,
      contact_id,
      contact_type,
      ledger_category,
      ledger_entity_type,
      ledger_flow_type,
      payment_reference,
      created_by
    ) values (
      p_organization_id,
      p_trip_id,
      coalesce(nullif(trim(p_client_party_name), ''), 'Client'),
      p_description,
      p_amount,
      0,
      coalesce(p_transaction_date, (timezone('utc', now()))::date),
      p_client_contact_id,
      case when p_client_contact_id is null then null else 'client' end,
      p_client_category,
      'client',
      'receivable',
      nullif(trim(p_payment_reference), ''),
      p_created_by
    )
    returning id into v_client_id;
  else
    v_client_id := v_existing_client;
  end if;

  if p_supplier_contact_id is not null and v_existing_supplier is null then
    insert into public.transactions (
      organization_id,
      trip_id,
      party_name,
      description,
      amount_in,
      amount_out,
      transaction_date,
      contact_id,
      contact_type,
      ledger_category,
      ledger_entity_type,
      ledger_flow_type,
      payment_reference,
      created_by
    ) values (
      p_organization_id,
      p_trip_id,
      coalesce(nullif(trim(p_supplier_party_name), ''), 'Supplier'),
      p_description,
      0,
      p_amount,
      coalesce(p_transaction_date, (timezone('utc', now()))::date),
      p_supplier_contact_id,
      'supplier',
      v_supplier_category,
      'supplier',
      'payable',
      nullif(trim(p_payment_reference), ''),
      p_created_by
    )
    returning id into v_supplier_id;
  else
    v_supplier_id := v_existing_supplier;
  end if;

  return jsonb_build_object(
    'client_transaction_id', v_client_id,
    'supplier_transaction_id', v_supplier_id,
    'created_client', v_existing_client is null,
    'created_supplier', p_supplier_contact_id is not null and v_existing_supplier is null,
    'already_posted', false
  );
end;
$$;

revoke all on function public.post_compliance_settlement_pair(
  uuid, uuid, text, numeric, text, date, text, uuid, text, uuid, text, uuid
) from public;
grant execute on function public.post_compliance_settlement_pair(
  uuid, uuid, text, numeric, text, date, text, uuid, text, uuid, text, uuid
) to authenticated;

comment on function public.post_compliance_settlement_pair is
  'Atomically post Compliance client Cash IN and optional supplier Cash OUT for one trip settlement. Idempotent when both legs already exist.';

-- ── 5. Backfill real supplier rows from existing client compliance posts ────
-- Statement UI reads contact-scoped rows only — no projected client→Out.
insert into public.transactions (
  organization_id,
  trip_id,
  party_name,
  description,
  amount_in,
  amount_out,
  transaction_date,
  contact_id,
  contact_type,
  ledger_category,
  ledger_entity_type,
  ledger_flow_type,
  payment_reference,
  created_by
)
select
  c.organization_id,
  c.trip_id,
  coalesce(nullif(trim(t.supplier_name), ''), 'Supplier'),
  c.description,
  0,
  c.amount_in,
  c.transaction_date,
  t.supplier_id,
  'supplier',
  case c.ledger_category
    when 'compliance_advance' then 'compliance_supplier_advance'
    else 'compliance_supplier_balance'
  end,
  'supplier',
  'payable',
  c.payment_reference,
  c.created_by
from public.transactions c
join public.trips t on t.id = c.trip_id
where c.ledger_category in ('compliance_advance', 'compliance_balance')
  and coalesce(c.amount_in, 0) > 0
  and t.supplier_id is not null
  and not exists (
    select 1
      from public.transactions s
     where s.trip_id = c.trip_id
       and s.ledger_category = case c.ledger_category
         when 'compliance_advance' then 'compliance_supplier_advance'
         else 'compliance_supplier_balance'
       end
  );
