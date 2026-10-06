/**
 * Optimistic approve/decline keys (`ComplianceDocumentWorkspace`'s
 * `localDecisionByKey`) are scoped per document tab, because a row's bare
 * key is just its document-type string (e.g. "other"), which can repeat
 * across Trip/Vehicle/Driver. Without scoping, a decision made on one tab
 * could read back on another tab's same-named row, and the component had to
 * wipe the whole map on every tab switch to stay safe — which also
 * discarded an in-flight decision on the *same* trip before the pipeline
 * refetch confirmed it (nihas V1.0.12). Scoping the key means the map only
 * needs to reset when the selected trip changes, not on a tab switch.
 */
export type ComplianceDocTab = "trip" | "vehicle" | "driver";

export function scopedDecisionKey(tab: ComplianceDocTab, rowKey: string): string {
  return `${tab}:${rowKey}`;
}
