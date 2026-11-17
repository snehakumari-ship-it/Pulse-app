import { memo } from "react";
import { Platform, Pressable, View, Text, StyleSheet } from "react-native";
import { Calendar, ChevronRight, CreditCard, Hash, Navigation } from "lucide-react-native";
import Theme from "@/constants/Theme";
import { PartyAvatar } from "@/components/PartyAvatar";
import type { NumericEntryPartyPreview } from "./NumericEntryPartyBanner";
import { PoolIndentMark } from "./PoolIndentMark";

export interface NumericEntryRecipientHeroProps {
  party: NumericEntryPartyPreview;
  /**
   * GPay-style line above the name (e.g. "Paying" → “Paying Rohit Kapoor”).
   * When set with `nameInline`, name is merged into one title line.
   */
  caption?: string;
  /** Merge caption + name into one title (“Paying {name}”). Default true when caption set. */
  nameInline?: boolean;
  /** Tighter block for allocation keypad steps above sticky footer. */
  compact?: boolean;
  /** Extra-dense for desktop popup sheets. */
  dense?: boolean;
  /** Tap recipient (e.g. change partner). */
  onPress?: () => void;
  /**
   * Expense keypad chrome: card, icons, and the driver emerald used on Log expense.
   */
  accent?: boolean;
}

/** Split corridor-style subtitle into hero route + quieter detail. */
function resolveHeroDetail(party: NumericEntryPartyPreview): {
  hero: string | null;
  detail: string | null;
} {
  const explicitHero = (party.heroLine ?? "").trim() || null;
  const explicitDetail = (party.detailLine ?? "").trim() || null;
  if (explicitHero) {
    return {
      hero: explicitHero,
      detail: explicitDetail,
    };
  }

  const subtitle = (party.subtitle ?? "").trim();
  if (!subtitle) return { hero: null, detail: null };

  if (subtitle.includes("→") || subtitle.includes("->")) {
    const parts = subtitle
      .split(" · ")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return { hero: null, detail: null };
    return {
      hero: parts[0] ?? null,
      detail: parts.slice(1).join(" · ") || null,
    };
  }

  return { hero: null, detail: subtitle };
}

/**
 * Centered recipient block (Google Pay payout) above the amount field.
 */
export const NumericEntryRecipientHero = memo(function NumericEntryRecipientHero({
  party,
  caption,
  nameInline = Boolean(caption),
  compact = false,
  dense = false,
  onPress,
  accent = false,
}: NumericEntryRecipientHeroProps) {
  const avatarSize = accent ? (dense ? 36 : 40) : dense ? 36 : compact ? 44 : 64;
  const title =
    caption && nameInline ? `${caption} ${party.name}`.trim() : party.name;
  const { hero, detail } = resolveHeroDetail(party);

  const detailChips = accent && detail
    ? detail.split(" · ").map((part) => part.trim()).filter(Boolean)
    : [];

  const avatarNode = (
    <View
      style={[
        styles.avatarSlot,
        accent && styles.avatarSlotAccent,
        { width: avatarSize, height: avatarSize },
      ]}
    >
      {party.mark === "pool" ? (
        <PoolIndentMark size={avatarSize} />
      ) : (
        <PartyAvatar
          name={party.name}
          avatarUrl={party.avatarUrl ?? null}
          avatarSeed={party.avatarSeed ?? null}
          organizationImageUrl={party.organizationImageUrl ?? null}
          organizationAvatarSeed={party.organizationAvatarSeed ?? null}
          entityType={party.entityType ?? "client"}
          isIntegrated={party.isIntegrated}
          size={avatarSize}
          shape="circle"
        />
      )}
    </View>
  );

  const content = accent ? (
    <View style={[styles.rootAccent, compact && styles.rootAccentCompact]}>
      <View style={styles.accentRow}>
        {avatarNode}
        <View style={styles.accentCopy}>
          {caption && !nameInline ? (
            <View style={styles.accentCaptionRow}>
              <CreditCard size={12} color={Theme.driverEmeraldDark} strokeWidth={2.4} />
              <Text style={styles.accentCaption} numberOfLines={1}>
                {caption}
              </Text>
            </View>
          ) : null}
          <View style={styles.accentTitleRow}>
            <Text style={styles.accentName} numberOfLines={2}>
              {title}
            </Text>
            {onPress ? (
              <ChevronRight size={14} color={Theme.textMuted} style={styles.chevron} />
            ) : null}
          </View>
          {hero ? (
            <View style={styles.routeRow}>
              <Navigation size={12} color={Theme.driverEmeraldDark} strokeWidth={2.4} />
              <Text style={styles.routeLabel} numberOfLines={2}>
                {hero}
              </Text>
            </View>
          ) : null}
          {detailChips.length > 0 ? (
            <View style={styles.chipRow}>
              {detailChips.map((chip) => {
                const isDate =
                  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(chip);
                const Icon = isDate ? Calendar : Hash;
                return (
                  <View key={chip} style={styles.metaChip}>
                    <Icon size={10} color={Theme.driverEmeraldDark} strokeWidth={2.4} />
                    <Text style={styles.metaChipText} numberOfLines={1}>
                      {chip}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : detail ? (
            <Text style={styles.accentDetail} numberOfLines={2}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  ) : (
    <View
      style={[
        styles.root,
        compact && styles.rootCompact,
        dense && styles.rootDense,
      ]}
    >
      {avatarNode}
      {caption && !nameInline ? (
        <Text
          style={[
            styles.caption,
            dense && styles.captionDense,
            compact && styles.captionTrip,
          ]}
          numberOfLines={1}
        >
          {caption}
        </Text>
      ) : null}
      <View style={styles.titleRow}>
        <Text
          style={[
            styles.name,
            compact && styles.nameCompact,
            dense && styles.nameDense,
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {onPress ? (
          <ChevronRight
            size={dense ? 14 : 16}
            color={Theme.textMuted}
            style={styles.chevron}
          />
        ) : null}
      </View>
      {hero ? (
        <Text
          style={[
            styles.heroLine,
            compact && styles.heroLineCompact,
            dense && styles.heroLineDense,
          ]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {hero}
        </Text>
      ) : null}
      {detail ? (
        <Text
          style={[
            styles.detailLine,
            compact && styles.detailLineCompact,
            dense && styles.detailLineDense,
          ]}
          numberOfLines={2}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Change ${party.name}`}
        style={({ pressed }) => [pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }

  return content;
});

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 6,
    width: "100%",
  },
  avatarSlot: {
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rootCompact: {
    paddingTop: 6,
    paddingBottom: 2,
    gap: 8,
  },
  rootDense: {
    paddingTop: 2,
    paddingBottom: 0,
    paddingHorizontal: 16,
    gap: 3,
  },
  rootAccent: {
    marginHorizontal: 16,
    marginTop: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: Theme.cardWhite,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.driverEmeraldBorderSoft,
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  rootAccentCompact: {
    marginTop: 0,
    paddingVertical: 10,
  },
  accentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
  },
  avatarSlotAccent: {
    alignSelf: "flex-start",
    marginTop: 2,
  },
  accentCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    alignItems: "flex-start",
  },
  accentCaptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 5,
    width: "100%",
  },
  accentCaption: {
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.65,
    textTransform: "uppercase",
    color: Theme.driverEmeraldDark,
    textAlign: "left",
  },
  accentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 2,
    width: "100%",
  },
  accentName: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    textAlign: "left",
    letterSpacing: -0.25,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    width: "100%",
  },
  routeLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 17,
    letterSpacing: -0.15,
    color: Theme.textPrimaryDark,
    textAlign: "left",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    width: "100%",
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Theme.driverEmeraldMuted,
  },
  metaChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: Theme.driverEmeraldDark,
  },
  accentDetail: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textSecondary,
    textAlign: "left",
    lineHeight: 16,
    width: "100%",
  },
  pressed: {
    opacity: 0.88,
  },
  caption: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "500",
    color: Theme.textSecondary,
    textAlign: "center",
  },
  captionDense: {
    marginTop: 4,
    fontSize: 11,
  },
  captionTrip: {
    marginTop: 0,
    marginBottom: 2,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.55,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    maxWidth: "100%",
    paddingHorizontal: 8,
  },
  name: {
    fontSize: 20,
    fontWeight: "500",
    color: Theme.textMuted,
    textAlign: "center",
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  nameCompact: {
    fontSize: 16,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    letterSpacing: -0.3,
  },
  nameDense: {
    fontSize: 14,
    fontWeight: "500",
    letterSpacing: -0.2,
  },
  chevron: {
    marginTop: 2,
    flexShrink: 0,
  },
  heroLine: {
    marginTop: 2,
    width: "100%",
    maxWidth: 340,
    paddingHorizontal: 4,
    fontSize: 22,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
    textAlign: "center",
    letterSpacing: -0.55,
    lineHeight: 28,
  },
  heroLineCompact: {
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24,
    letterSpacing: 0,
    color: Theme.textPrimaryDark,
  },
  heroLineDense: {
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 22,
    letterSpacing: 0,
    maxWidth: 320,
    color: Theme.textPrimaryDark,
  },
  detailLine: {
    fontSize: 13,
    fontWeight: "600",
    color: Theme.textSecondary,
    textAlign: "center",
    lineHeight: 18,
    letterSpacing: 0,
    maxWidth: 320,
    paddingHorizontal: 8,
  },
  detailLineCompact: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 17,
    color: Theme.textPrimaryDark,
  },
  detailLineDense: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    maxWidth: 280,
    color: Theme.textPrimaryDark,
  },
});
