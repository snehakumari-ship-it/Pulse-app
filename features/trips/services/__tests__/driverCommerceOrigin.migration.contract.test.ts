import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION =
  "supabase/migrations/20270913091000_driver_commerce_origin_read_boundary.sql";
const PREVIOUS_VIEW =
  "supabase/migrations/20270912140000_trips_driver_view_dco_operating_mode.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const previousView = readFileSync(join(process.cwd(), PREVIOUS_VIEW), "utf8");

describe("driver commerce origin read boundary", () => {
  it("defines a security-definer helper with an explicit search_path", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.driver_owned_indent_execution_plan_id\(p_indent_id uuid\)/,
    );
    expect(sql).toMatch(/RETURNS uuid/);
    expect(sql).toMatch(/LANGUAGE sql/);
    expect(sql).toMatch(/STABLE/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("returns only execution_plan_id for an indent on a caller-owned trip", () => {
    expect(sql).toMatch(/SELECT i\.execution_plan_id/);
    expect(sql).toMatch(/WHERE p_indent_id IS NOT NULL/);
    expect(sql).toMatch(/AND i\.id = p_indent_id/);
    expect(sql).toMatch(/JOIN public\.drivers d ON d\.id = t\.driver_id/);
    expect(sql).toMatch(/d\.user_id = \(SELECT auth\.uid\(\)\)/);
    expect(sql).toMatch(/t\.indent_id = p_indent_id/);
    expect(sql).toMatch(/t\.source_indent_id = p_indent_id/);
    expect(sql).not.toMatch(/p_execution_plan_id/);
    expect(sql).not.toMatch(/GRANT SELECT ON (TABLE )?public\.indents/i);
  });

  it("revokes public and anon execute and grants authenticated only", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.driver_owned_indent_execution_plan_id\(uuid\) FROM PUBLIC/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.driver_owned_indent_execution_plan_id\(uuid\) FROM anon/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.driver_owned_indent_execution_plan_id\(uuid\) TO authenticated/i,
    );
    expect(sql).not.toMatch(/TO anon/i);
    expect(sql).not.toMatch(/TO service_role/i);
  });

  it("keeps trips_driver_view security_invoker and the existing driver filter", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE VIEW public\.trips_driver_view\s+WITH \(security_invoker = true\) AS/,
    );
    const ownership =
      "WHERE t.driver_id IN (\n  SELECT d.id FROM public.drivers d WHERE d.user_id = (SELECT auth.uid())\n)";
    expect(previousView).toContain(ownership);
    expect(sql).toContain(ownership);
  });

  it("resolves plan ids once per row, indent_id first, then source_indent_id", () => {
    expect(sql).toMatch(
      /LEFT JOIN LATERAL \(\s*SELECT COALESCE\(\s*public\.driver_owned_indent_execution_plan_id\(t\.indent_id\),\s*public\.driver_owned_indent_execution_plan_id\(t\.source_indent_id\)\s*\) AS execution_plan_id/,
    );
    expect(sql).toMatch(
      /commerce_origin\.execution_plan_id AS execution_plan_id/,
    );
    expect(sql).toMatch(
      /\(commerce_origin\.execution_plan_id IS NOT NULL\) AS is_commerce/,
    );
    expect(sql).not.toMatch(/COALESCE\(\s*t\.indent_id/i);
  });

  it("keeps the previous view columns and adds no index", () => {
    for (const column of [
      "t.indent_id,",
      "t.source_indent_id,",
      "t.operating_mode,",
      "t.dco_payee_id,",
      "t.organization_id,",
      "t.client_price,",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toMatch(/CREATE INDEX/i);
  });
});
