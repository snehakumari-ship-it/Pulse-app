import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION =
  "supabase/migrations/20271006142659_omnichannel_award_channel_classification.sql";
const PREVIOUS =
  "supabase/migrations/20270925194500_marketplace_convert_skip_network_supplier_gate.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const previous = readFileSync(join(process.cwd(), PREVIOUS), "utf8");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("$function$;", start);
  return source.slice(start, end);
}

describe("omni-channel award classification", () => {
  const predicate = functionBody(sql, "is_marketplace_indent_award");
  const deploy = functionBody(sql, "create_trip_from_assigned_indent");

  it("sorts after the migration whose definitions it replaces", () => {
    expect(MIGRATION.localeCompare(PREVIOUS)).toBeGreaterThan(0);
  });

  it("decides the channel from the winning offer, not circulation_target alone", () => {
    expect(predicate).toMatch(/mb\.status = 'accepted'/);
    expect(predicate).toMatch(/mb\.bidder_organization_id = p_bidder_org/);
    expect(predicate).toMatch(
      /IN \('marketplace', 'both'\)\s+AND NOT public\.is_approved_supplier\(i\.organization_id, p_bidder_org\)/,
    );
    expect(predicate).not.toMatch(/p_bidder_org IS NULL\s+OR/);
  });

  it("treats a missing indent or bidder as not a Marketplace award", () => {
    expect(predicate).toMatch(/p_indent_id IS NOT NULL\s+AND p_bidder_org IS NOT NULL/);
  });

  it("keeps the predicate security definer with a pinned search_path", () => {
    expect(predicate).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.is_marketplace_indent_award\(uuid, uuid\) FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_marketplace_indent_award\(uuid, uuid\) TO authenticated/,
    );
  });

  it("never binds a deploy to another bidder's accepted bid", () => {
    expect(deploy).not.toMatch(/ORDER BY accepted_at DESC/);
    const bidReadsByIndent =
      deploy.match(/SELECT \* INTO v_market_bid\s+FROM public\.market_bids\s+WHERE indent_id = p_indent_id/g) ?? [];
    expect(bidReadsByIndent).toHaveLength(1);
    expect(deploy).toMatch(/AND bidder_organization_id = v_supplier_org_id/);
  });

  it("changes nothing else in the deploy function", () => {
    const before = functionBody(previous, "create_trip_from_assigned_indent");
    const fallback =
      /\n    IF v_is_market_award THEN\n      SELECT \* INTO v_market_bid\n      FROM public\.market_bids\n      WHERE indent_id = p_indent_id\n        AND status = 'accepted'\n      ORDER BY accepted_at DESC NULLS LAST, updated_at DESC\n      LIMIT 1;\n    END IF;/;
    expect(before).toMatch(fallback);
    const strip = (s: string) => s.replace(/^\s*--.*$/gm, "").replace(/\s+/g, " ");
    expect(strip(deploy)).toBe(strip(before.replace(fallback, "")));
  });

  it("keeps Network awards linked to the shipper's supplier row", () => {
    expect(deploy).toMatch(
      /v_supplier_id := public\.ensure_awarded_bidder_supplier\(v_org_id, v_supplier_org_id\);/,
    );
    expect(deploy).toMatch(/v_client_price := coalesce\(v_indent\.client_price, 0\);/);
  });
});
