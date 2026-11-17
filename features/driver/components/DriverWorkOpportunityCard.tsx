/**
 * Shared Find Work / My Bids card — matches Market bid-card hierarchy:
 * avatar + title | rate on the right, aligned fact rows, primary + Full view CTAs.
 */
import { PartyAvatar } from '@/components/PartyAvatar';
import Theme from '@/constants/Theme';
import { splitLocationParts } from '@/features/network/utils/storyDisplay';
import { withWebSafeShadows } from '@/lib/platformViewStyle.util';
import { Calendar, MapPin, Package, Truck } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type WorkOpportunityBadge = 'boosted' | 'open' | 'awarded' | 'quoted' | null;

export type WorkOpportunityPrimaryCta = {
  title: string;
  hint?: string | null;
  onPress: () => void;
  variant?: 'primary' | 'quoted' | 'info';
};

export type WorkOpportunityRateDetail = {
  label: string;
  value: string;
  hint?: string | null;
};

function formatPickupChip(iso?: string | null): string | null {
  const raw = (iso ?? '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function FactRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.factRow} accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.factLabelWrap}>
        {icon}
        <Text style={styles.factLabel}>{label}</Text>
      </View>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function DriverWorkOpportunityCard({
  orgName,
  orgLogoUrl,
  orgAvatarSeed,
  orgSeed,
  kicker,
  badge,
  origin,
  destination,
  vehicleType,
  material,
  pickupDate,
  fleetMatch,
  targetLabel,
  targetValue,
  rateDetails,
  insight,
  extra,
  primaryCta,
  secondaryCta,
}: {
  orgName: string;
  orgLogoUrl?: string | null;
  orgAvatarSeed?: string | null;
  orgSeed?: string | null;
  kicker: string;
  badge?: WorkOpportunityBadge;
  origin?: string | null;
  destination?: string | null;
  vehicleType?: string | null;
  material?: string | null;
  pickupDate?: string | null;
  fleetMatch?: boolean;
  targetLabel?: string | null;
  targetValue?: string | null;
  rateDetails?: readonly WorkOpportunityRateDetail[] | null;
  insight?: string | null;
  extra?: ReactNode;
  primaryCta?: WorkOpportunityPrimaryCta | null;
  secondaryCta?: { title: string; onPress: () => void } | null;
}) {
  const pickupCity = splitLocationParts(origin).city;
  const dropCity = splitLocationParts(destination).city;
  const pickup = pickupCity && pickupCity !== '—' ? pickupCity : 'Pickup';
  const drop = dropCity && dropCity !== '—' ? dropCity : 'Drop';
  const routeLine = `${pickup} → ${drop}`;
  const vehicle = vehicleType?.trim() || null;
  const goods = material?.trim() || null;
  const dateLabel = formatPickupChip(pickupDate);
  const badgeLabel =
    badge === 'boosted'
      ? 'Boosted'
      : badge === 'open'
        ? 'Market'
        : badge === 'awarded'
          ? 'Awarded'
          : badge === 'quoted'
            ? 'Quoted'
            : null;

  const iconMuted = Theme.textMuted;

  return (
    <View style={[styles.card, badge === 'awarded' && styles.cardAwarded]}>
      <View style={styles.body}>
        <View style={styles.top}>
          <View style={styles.orgRow}>
            <PartyAvatar
              name={orgName || 'Shipper'}
              initialsColorSeed={orgSeed ?? orgName}
              organizationImageUrl={orgLogoUrl}
              organizationAvatarSeed={orgAvatarSeed}
              entityType="client"
              size={36}
              shape="rounded"
            />
            <View style={styles.orgText}>
              <View style={styles.titleRow}>
                <Text style={styles.orgName} numberOfLines={2}>
                  {orgName || 'Shipper'}
                </Text>
                {fleetMatch ? (
                  <View style={styles.matchPill} accessibilityLabel="Fleet match">
                    <Text style={styles.matchPillText}>Fleet match</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.kickerRow}>
                <Text
                  style={[styles.kicker, badge === 'awarded' && styles.kickerAwarded]}
                  numberOfLines={1}
                >
                  {kicker}
                </Text>
                {badgeLabel ? (
                  <View
                    style={[
                      styles.badge,
                      badge === 'awarded'
                        ? styles.badgeAwarded
                        : badge === 'quoted'
                          ? styles.badgeQuoted
                          : styles.badgeBoosted,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        badge === 'awarded' && styles.badgeTextAwarded,
                        badge === 'quoted' && styles.badgeTextQuoted,
                      ]}
                    >
                      {badgeLabel}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
          {targetValue ? (
            <View
              style={styles.priceBlock}
              accessibilityLabel={`${targetLabel ?? 'Rate'} ${targetValue}`}
            >
              {targetLabel ? (
                <Text style={styles.priceLabel} numberOfLines={1}>
                  {targetLabel}
                </Text>
              ) : null}
              <Text style={styles.priceValue} numberOfLines={1}>
                {targetValue}
              </Text>
            </View>
          ) : null}
        </View>

        {rateDetails && rateDetails.length > 0 ? (
          <View style={styles.rateDetails}>
            {rateDetails.map((row) => (
              <View key={`${row.label}-${row.value}`} style={styles.rateDetailItem}>
                <Text style={styles.rateDetailLabel}>{row.label}</Text>
                <Text style={styles.rateDetailValue} numberOfLines={1}>
                  {row.value}
                </Text>
                {row.hint ? (
                  <Text style={styles.rateDetailHint} numberOfLines={1}>
                    {row.hint}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.facts}>
          <FactRow
            icon={<MapPin size={12} color={iconMuted} strokeWidth={2.2} />}
            label="Route"
            value={routeLine}
          />
          {dateLabel ? (
            <FactRow
              icon={<Calendar size={12} color={iconMuted} strokeWidth={2.2} />}
              label="Timeline"
              value={dateLabel}
            />
          ) : null}
          {vehicle ? (
            <FactRow
              icon={<Truck size={12} color={iconMuted} strokeWidth={2.2} />}
              label="Vehicle"
              value={vehicle}
            />
          ) : null}
          {goods ? (
            <FactRow
              icon={<Package size={12} color={iconMuted} strokeWidth={2.2} />}
              label="Cargo"
              value={goods}
            />
          ) : null}
        </View>

        {insight ? (
          <View style={styles.insightBanner}>
            <Text style={styles.insightText} numberOfLines={1}>
              {insight}
            </Text>
          </View>
        ) : null}

        {extra}
      </View>

      {primaryCta || secondaryCta ? (
        <View style={styles.actionsRow}>
          {primaryCta ? (
            <View style={styles.actionPrimary}>
              {primaryCta.variant === 'info' ? (
                <View style={styles.infoPill}>
                  <Text style={styles.infoPillText}>{primaryCta.title}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={primaryCta.variant === 'quoted' ? styles.quotedBtn : styles.ctaBtn}
                  activeOpacity={0.88}
                  onPress={primaryCta.onPress}
                >
                  <Text
                    style={
                      primaryCta.variant === 'quoted' ? styles.quotedBtnText : styles.ctaBtnText
                    }
                    numberOfLines={1}
                  >
                    {primaryCta.title}
                  </Text>
                  {primaryCta.hint ? (
                    <Text
                      style={
                        primaryCta.variant === 'quoted'
                          ? styles.quotedBtnHint
                          : styles.ctaBtnHint
                      }
                      numberOfLines={1}
                    >
                      {primaryCta.hint}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              )}
            </View>
          ) : null}
          {secondaryCta ? (
            <TouchableOpacity
              style={styles.fullViewBtn}
              activeOpacity={0.88}
              onPress={secondaryCta.onPress}
              accessibilityRole="button"
              accessibilityLabel={secondaryCta.title}
            >
              <Text style={styles.fullViewBtnText}>{secondaryCta.title}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = withWebSafeShadows(
  StyleSheet.create({
    card: {
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Theme.borderLight,
      padding: 14,
      gap: 12,
      backgroundColor: Theme.cardWhite,
      ...Platform.select({
        ios: {
          shadowColor: Theme.primaryText,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        android: { elevation: 2 },
        default: {},
      }),
    },
    cardAwarded: {
      borderColor: Theme.darkGreen,
      borderWidth: 1,
      backgroundColor: Theme.positiveMuted,
    },
    body: { gap: 10 },
    top: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    orgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 },
    orgText: { flex: 1, minWidth: 0, gap: 4 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      columnGap: 6,
      rowGap: 4,
    },
    orgName: {
      flexGrow: 0,
      flexShrink: 1,
      maxWidth: '100%',
      fontSize: 14,
      fontWeight: '700',
      color: Theme.textPrimaryDark,
      letterSpacing: -0.2,
    },
    kickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
    },
    kicker: {
      fontSize: 9,
      fontWeight: '700',
      color: Theme.textMuted,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    kickerAwarded: { color: Theme.darkGreen },
    badge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      flexShrink: 0,
    },
    badgeBoosted: { backgroundColor: Theme.accentBrown },
    badgeQuoted: {
      backgroundColor: Theme.surfaceGray,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Theme.borderMedium,
    },
    badgeAwarded: {
      borderRadius: 4,
      backgroundColor: Theme.cardWhite,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Theme.darkGreen,
    },
    badgeText: {
      fontSize: 8,
      fontWeight: '800',
      color: Theme.textOnPrimary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    badgeTextQuoted: { color: Theme.textSecondary },
    badgeTextAwarded: { color: Theme.darkGreen },
    priceBlock: {
      alignItems: 'flex-end',
      flexShrink: 0,
      paddingTop: 2,
      minWidth: 88,
      maxWidth: '38%',
      gap: 2,
    },
    priceLabel: {
      fontSize: 9,
      fontWeight: '700',
      color: Theme.textMuted,
      letterSpacing: 0.45,
      textTransform: 'uppercase',
    },
    priceValue: {
      fontSize: 17,
      fontWeight: '800',
      color: Theme.textPrimaryDark,
      letterSpacing: -0.4,
      lineHeight: 20,
    },
    rateDetails: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      backgroundColor: Theme.surfaceGray,
    },
    rateDetailItem: {
      minWidth: '30%',
      flexGrow: 1,
      gap: 1,
    },
    rateDetailLabel: {
      fontSize: 9,
      fontWeight: '600',
      color: Theme.textMuted,
      letterSpacing: 0.2,
      textTransform: 'uppercase',
    },
    rateDetailValue: {
      fontSize: 12,
      fontWeight: '700',
      color: Theme.textPrimaryDark,
      letterSpacing: -0.15,
    },
    rateDetailHint: {
      fontSize: 9,
      fontWeight: '500',
      color: Theme.textMuted,
    },
    facts: {
      gap: 7,
      paddingTop: 2,
    },
    factRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      minHeight: 20,
    },
    factLabelWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      width: 92,
      flexShrink: 0,
    },
    factLabel: {
      fontSize: 12,
      fontWeight: '500',
      color: Theme.textMuted,
    },
    factValue: {
      flex: 1,
      minWidth: 0,
      textAlign: 'right',
      fontSize: 13,
      fontWeight: '700',
      color: Theme.textPrimaryDark,
      letterSpacing: -0.15,
    },
    matchPill: {
      flexShrink: 0,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: Theme.positiveMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Theme.driverCtaFill,
    },
    matchPillText: {
      fontSize: 10,
      fontWeight: '700',
      color: Theme.driverCtaFill,
      letterSpacing: -0.1,
    },
    insightBanner: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 8,
      backgroundColor: Theme.accentBrownWash,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Theme.accentBrownBorder,
      alignItems: 'center',
    },
    insightText: {
      fontSize: 11,
      fontWeight: '600',
      color: Theme.accentBrownDeep,
      letterSpacing: -0.1,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 8,
    },
    actionPrimary: { flex: 1, minWidth: 0, justifyContent: 'center' },
    ctaBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: Theme.driverCtaFill,
      borderWidth: 0,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    ctaBtnText: {
      fontSize: 13,
      fontWeight: '700',
      color: Theme.textOnPrimary,
      letterSpacing: -0.1,
    },
    ctaBtnHint: {
      fontSize: 10,
      fontWeight: '500',
      color: Theme.textOnPrimary,
      opacity: 0.85,
    },
    quotedBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: Theme.driverCtaFill,
      borderWidth: 0,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    quotedBtnText: {
      fontSize: 13,
      fontWeight: '700',
      color: Theme.textOnPrimary,
      letterSpacing: -0.1,
    },
    quotedBtnHint: {
      fontSize: 10,
      fontWeight: '500',
      color: Theme.textOnPrimary,
      opacity: 0.85,
    },
    infoPill: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Theme.borderLight,
      backgroundColor: Theme.surfaceGray,
      paddingVertical: 9,
      paddingHorizontal: 10,
    },
    infoPillText: {
      fontSize: 11,
      fontWeight: '500',
      textAlign: 'center',
      color: Theme.textMuted,
    },
    fullViewBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
      minHeight: 48,
      minWidth: 92,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: Theme.driverCtaFill,
      backgroundColor: Theme.cardWhite,
    },
    fullViewBtnText: {
      fontSize: 12,
      fontWeight: '700',
      color: Theme.driverCtaFill,
    },
  }),
);
