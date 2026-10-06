/**
 * Sponsored Reach is the one individual commercial opportunity: an indent with
 * an active Reach campaign. Marketplace rows carry it as is_sponsored /
 * reach_campaign_id; the Network feed carries it as an active sponsored LOAD
 * post linked to the indent through source_indent_id. A sponsored indent is
 * never a member of an Indent Pool, on any surface.
 */

type SponsoredPostFields = {
  type?: string | null;
  is_active?: boolean | null;
  is_sponsored?: boolean | null;
  source_indent_id?: string | null;
};

type SponsoredLoadFields = {
  id: string;
  is_sponsored?: boolean | null;
  reach_campaign_id?: string | null;
};

export function isSponsoredReachPost(post: SponsoredPostFields): boolean {
  return (
    post.is_sponsored === true &&
    post.is_active !== false &&
    (post.type ?? "").toUpperCase() === "LOAD"
  );
}

/** Indents with an active sponsored LOAD post in the Network feed. */
export function sponsoredReachIndentIds(
  posts: readonly SponsoredPostFields[] | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const post of posts ?? []) {
    const indentId = (post.source_indent_id ?? "").trim();
    if (indentId && isSponsoredReachPost(post)) ids.add(indentId);
  }
  return ids;
}

export function isSponsoredReachLoad(
  load: SponsoredLoadFields,
  sponsoredIndentIds?: ReadonlySet<string>,
): boolean {
  return (
    load.is_sponsored === true ||
    !!(load.reach_campaign_id ?? "").trim() ||
    (sponsoredIndentIds?.has(load.id) ?? false)
  );
}
