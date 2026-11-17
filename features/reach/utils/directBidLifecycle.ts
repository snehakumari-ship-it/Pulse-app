/**
 * FO / independent driver direct-bid lifecycle labels for Stories / Loads list.
 * Counter uses counter_amount (pending + counter); award uses accepted.
 *
 * LOADS tab = get new work (open / quoted / counter). Awarded & rejected
 * jobs are not opportunity feed items — those belong on History / trip surfaces.
 */
import type { DriverReachStoryRow } from '@/features/reach/services/driverReferrals.service';
import { positiveMoneyOrNull } from '@/lib/format';

export type DirectBidUiBucket =
  | 'open'
  | 'quoted'
  | 'counter'
  | 'awarded'
  | 'rejected'
  | 'superseded'
  | 'other';

/**
 * Filters on the Market / Find Work STATUS dropdown.
 * `negotiating` covers quoted + counter. `awarded` / `closed` surface history
 * rows that the default "All" opportunity feed hides.
 * Legacy URL params `quoted` / `counter` map to `negotiating` via parse helper.
 */
export type BidStatusFilter =
  | 'all'
  | 'open'
  | 'negotiating'
  | 'awarded'
  | 'closed';

const BID_STATUS_FILTERS: readonly BidStatusFilter[] = [
  'all',
  'open',
  'negotiating',
  'awarded',
  'closed',
] as const;

export function bidStatusFilterOptions(): readonly BidStatusFilter[] {
  return BID_STATUS_FILTERS;
}

/** Normalize URL / legacy params into a BidStatusFilter. */
export function parseBidStatusFilterParam(raw: string | undefined | null): BidStatusFilter {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'open' || v === 'negotiating' || v === 'awarded' || v === 'closed') return v;
  // Legacy Find Work URL params from before the STATUS dropdown redesign.
  if (v === 'quoted' || v === 'counter') return 'negotiating';
  return 'all';
}

const BUCKET_RANK: Record<DirectBidUiBucket, number> = {
  counter: 0,
  quoted: 1,
  open: 2,
  other: 3,
  awarded: 4,
  rejected: 5,
  superseded: 6,
};

export function directBidUiBucket(story: DriverReachStoryRow): DirectBidUiBucket {
  const status = story.direct_bid_status;
  if (status === 'accepted') return 'awarded';
  if (status === 'rejected') return 'rejected';
  // A6.4: became moot because the driver was awarded a DIFFERENT load —
  // not a business decision, not a driver withdrawal. Must not fall into
  // 'other' (which isLoadOpportunity treats as still-biddable) or this load
  // resurfaces with a "Bid Now" CTA as if the driver never bid on it.
  if (status === 'superseded') return 'superseded';
  if (status === 'pending') {
    const counter = positiveMoneyOrNull(story.direct_bid_counter_amount);
    if (counter != null) return 'counter';
    return 'quoted';
  }
  if (status == null) return 'open';
  return 'other';
}

/** True when the row is still an actionable load opportunity. */
export function isLoadOpportunity(story: DriverReachStoryRow): boolean {
  const bucket = directBidUiBucket(story);
  if (bucket === 'awarded' || bucket === 'rejected' || bucket === 'superseded') return false;
  // Converted referral earnings stay in RPC for the earnings card — not LOADS.
  if (story.referral_status === 'rewarded') return false;
  if ((story.campaign_status ?? '').toLowerCase() !== 'active') return false;
  if (story.source_deleted_at) return false;
  return true;
}

export function matchesBidStatusFilter(
  story: DriverReachStoryRow,
  filter: BidStatusFilter,
): boolean {
  const bucket = directBidUiBucket(story);
  if (filter === 'all') {
    return isLoadOpportunity(story);
  }
  if (filter === 'open') {
    return isLoadOpportunity(story) && bucket === 'open';
  }
  if (filter === 'negotiating') {
    return isLoadOpportunity(story) && (bucket === 'quoted' || bucket === 'counter');
  }
  if (filter === 'awarded') {
    return bucket === 'awarded';
  }
  // closed: rejected / superseded / expired referral / inactive campaign
  if (bucket === 'rejected' || bucket === 'superseded') return true;
  if (story.referral_status === 'expired') return true;
  const campaign = (story.campaign_status ?? '').toLowerCase();
  return campaign !== '' && campaign !== 'active' && !isLoadOpportunity(story);
}

export function bidStatusFilterLabel(filter: BidStatusFilter): string {
  switch (filter) {
    case 'open':
      return 'Open / Bidding Active';
    case 'negotiating':
      return 'Under Negotiation';
    case 'awarded':
      return 'Awarded';
    case 'closed':
      return 'Closed / Expired';
    default:
      return 'All';
  }
}

export function bidStatusFilterTone(
  filter: BidStatusFilter,
): 'neutral' | 'open' | 'negotiating' | 'awarded' | 'closed' {
  switch (filter) {
    case 'open':
      return 'open';
    case 'negotiating':
      return 'negotiating';
    case 'awarded':
      return 'awarded';
    case 'closed':
      return 'closed';
    default:
      return 'neutral';
  }
}

/**
 * One card per load post. Prefer actionable bid state, then newest campaign.
 * Fixes duplicate cards when the same post has multiple Reach campaigns
 * or when the RPC join multiplies rows.
 */
export function dedupeDriverReachStories(
  stories: DriverReachStoryRow[],
): DriverReachStoryRow[] {
  const byPost = new Map<string, DriverReachStoryRow>();

  for (const story of stories) {
    const key = (story.post_id || story.campaign_id || '').trim();
    if (!key) continue;

    const prev = byPost.get(key);
    if (!prev) {
      byPost.set(key, story);
      continue;
    }

    const prevRank = BUCKET_RANK[directBidUiBucket(prev)];
    const nextRank = BUCKET_RANK[directBidUiBucket(story)];
    if (nextRank < prevRank) {
      byPost.set(key, story);
      continue;
    }
    if (nextRank > prevRank) continue;

    const prevT = Date.parse(prev.published_at ?? '') || 0;
    const nextT = Date.parse(story.published_at ?? '') || 0;
    if (nextT >= prevT) byPost.set(key, story);
  }

  return [...byPost.values()];
}

/** Sort opportunities: counters first, then quoted, then open; fleet match next. */
export function compareLoadOpportunities(
  a: { bucket: DirectBidUiBucket; matchesFleet: boolean },
  b: { bucket: DirectBidUiBucket; matchesFleet: boolean },
): number {
  const ra = BUCKET_RANK[a.bucket];
  const rb = BUCKET_RANK[b.bucket];
  if (ra !== rb) return ra - rb;
  if (a.matchesFleet !== b.matchesFleet) return a.matchesFleet ? -1 : 1;
  return 0;
}
