/**
 * Full-page pre-DCO fleet earnings (same TO COLLECT + employer cards as
 * non-DCO wallet Fleet), for converted DCOs reviewing former employer dues.
 */
import { DriverCapturePaymentButton } from "@/features/drivers/components/DriverCapturePaymentButton";
import {
  driverBodySecondary,
  driverUISemiBold,
} from "@/constants/DriverTypography";
import Layout from "@/constants/Layout";
import Theme from "@/constants/Theme";
import { resolveDriverOrgAvatarUri } from "@/features/drivers/utils/resolveDriverOrgAvatar.util";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { History, Sparkles, Wallet, X } from "lucide-react-native";
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

export type PreDcoFleetCard = {
  orgId: string;
  orgName: string;
  driverId: string;
  earned: number;
  pending: number;
  received: number;
  tripsCompleted: number;
  joinedAt: string;
  leftAt: string | null;
  isCurrent?: boolean;
};

export type PreDcoFleetTripLine = {
  tripId: string;
  displayId: string;
  orgName: string;
  route: string;
  earned: number;
  received: number;
  pending: number;
  dateLabel: string;
};

type OrgAvatar = {
  logoUrl?: string | null;
  avatarUrl?: string | null;
  avatarSeed?: string | null;
};

type Colors = {
  background: string;
  surface: string;
  surfaceElevated: string;
  text: string;
  textMuted: string;
  border: string;
  borderSubtle: string;
  emerald: string;
};

type Props = {
  colors: Colors;
  isDark: boolean;
  fleets: PreDcoFleetCard[];
  trips: PreDcoFleetTripLine[];
  orgAvatarById: Record<string, OrgAvatar | undefined>;
  onClose: () => void;
  onOpenPassbook: (orgId: string, orgName: string) => void;
  onOpenTrip: (tripId: string) => void;
  /** Settlements keeps its own header. This view fills the space below it. */
  embedded?: boolean;
};

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function EmployerIllustration() {
  return (
    <Svg width={92} height={78} viewBox="0 0 92 78">
      <Ellipse cx="18" cy="66" rx="16" ry="8" fill={Theme.driverEmeraldMuted} />
      <Ellipse cx="74" cy="66" rx="14" ry="7" fill={Theme.driverEmeraldMuted} />
      <Rect x="28" y="16" width="36" height="48" rx="4" fill={Theme.driverEmeraldWash} stroke={Theme.driverCtaFill} strokeWidth="1.6" />
      <Rect x="40" y="46" width="12" height="18" rx="1.5" fill={Theme.cardWhite} stroke={Theme.driverCtaFill} strokeWidth="1.2" />
      <Rect x="34" y="24" width="8" height="7" rx="1" fill={Theme.cardWhite} stroke={Theme.driverEmerald} strokeWidth="1" />
      <Rect x="50" y="24" width="8" height="7" rx="1" fill={Theme.cardWhite} stroke={Theme.driverEmerald} strokeWidth="1" />
      <Rect x="34" y="36" width="8" height="7" rx="1" fill={Theme.cardWhite} stroke={Theme.driverEmerald} strokeWidth="1" />
      <Rect x="50" y="36" width="8" height="7" rx="1" fill={Theme.cardWhite} stroke={Theme.driverEmerald} strokeWidth="1" />
      <Path d="M24 16 L46 6 L68 16" fill={Theme.driverEmeraldWash} stroke={Theme.driverCtaFill} strokeWidth="1.6" strokeLinejoin="round" />
      <Circle cx="16" cy="60" r="7" fill={Theme.driverEmerald} opacity={0.85} />
      <Circle cx="76" cy="60" r="6" fill={Theme.driverEmerald} opacity={0.7} />
    </Svg>
  );
}

function RouteIllustration() {
  return (
    <Svg width={92} height={78} viewBox="0 0 92 78">
      <Path
        d="M16 62 C28 62 30 28 46 28 C62 28 60 50 76 22"
        fill="none"
        stroke={Theme.driverEmerald}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <Path
        d="M18 68 C34 66 40 48 54 50 C68 52 70 40 82 36"
        fill="none"
        stroke={Theme.driverEmeraldMutedText}
        strokeWidth="2"
        strokeDasharray="3 4"
        strokeLinecap="round"
      />
      <Circle cx="16" cy="62" r="7" fill={Theme.driverEmerald} />
      <Circle cx="16" cy="62" r="3" fill={Theme.cardWhite} />
      <Circle cx="76" cy="22" r="7" fill={Theme.driverGold} />
      <Circle cx="76" cy="22" r="3" fill={Theme.cardWhite} />
      <Circle cx="48" cy="40" r="4" fill={Theme.driverCtaFill} opacity={0.35} />
    </Svg>
  );
}

function formatPeriod(from: string, to?: string | null): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return `${fmt(new Date(from))} – ${to ? fmt(new Date(to)) : "Present"}`;
}

export function DriverPreDcoFleetHistoryView({
  colors,
  isDark,
  fleets,
  trips,
  orgAvatarById,
  onClose,
  onOpenPassbook,
  onOpenTrip,
  embedded = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const toCollect = fleets.reduce((sum, f) => sum + Math.max(0, f.pending), 0);

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: embedded
            ? isDark
              ? colors.background
              : Theme.driverEmeraldWash
            : colors.background,
          paddingTop: embedded ? 0 : insets.top,
        },
      ]}
    >
      {embedded ? null : (
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={onClose}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Close history"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <X size={18} color={colors.text} strokeWidth={2.2} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.kicker, { color: colors.textMuted }]}>Before DCO</Text>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            Fleet earnings
          </Text>
        </View>
        <History size={18} color={colors.emerald} strokeWidth={2.2} />
      </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 28,
          paddingHorizontal: Layout.screenPaddingHorizontal,
          paddingTop: 12,
        }}
        showsVerticalScrollIndicator={false}
      >
        {embedded ? null : <Text style={styles.heroTitle}>SALARY.</Text>}
        <Text style={styles.heroSub}>Financial audit & settlements · former employer</Text>

        <View style={styles.walletCardWrap}>
          <LinearGradient
            colors={
              isDark
                ? [Theme.driverEmeraldDark, colors.surface]
                : [Theme.cardWhite, Theme.cardWhite]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.walletCard,
              {
                borderWidth: 1,
                borderColor: isDark ? colors.border : Theme.borderMedium,
              },
            ]}
          >
            <View style={styles.walletWatermark} pointerEvents="none">
              <Wallet size={108} color={Theme.driverCtaFill} strokeWidth={1.2} />
            </View>
            <View style={styles.walletCardContent}>
              <View style={styles.walletLabelRow}>
                <Sparkles size={12} color={isDark ? colors.text : Theme.textSecondary} strokeWidth={2.4} />
                <Text style={[styles.walletLabel, { color: isDark ? colors.textMuted : Theme.textSecondary }]}>
                  TO COLLECT
                </Text>
              </View>
              <View style={styles.walletBalanceRow}>
                <Text style={[styles.walletRupee, { color: isDark ? colors.text : Theme.textPrimary }]}>₹</Text>
                <Text
                  style={[
                    styles.walletBalance,
                    Platform.OS === "android" && styles.walletBalanceAndroid,
                    { color: isDark ? colors.text : Theme.textPrimary },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {Math.round(toCollect).toLocaleString("en-IN")}
                </Text>
              </View>
              <View
                style={[
                  styles.walletPill,
                  { backgroundColor: isDark ? colors.surface : Theme.driverEmeraldWash },
                ]}
              >
                <Text style={[styles.walletSub, { color: isDark ? colors.textMuted : Theme.textSecondary }]}>
                  pending from fleet before conversion
                </Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Former employer</Text>
        {fleets.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: colors.surface,
                borderColor: isDark ? colors.borderSubtle : Theme.borderLight,
              },
            ]}
          >
            <EmployerIllustration />
            <Text style={[styles.emptyText, { color: colors.text }]}>
              No fleet employment on file from before DCO conversion.
            </Text>
          </View>
        ) : (
          fleets.map((fleet) => {
            const branding = orgAvatarById[fleet.orgId];
            const uri = resolveDriverOrgAvatarUri({
              orgId: fleet.orgId,
              orgName: fleet.orgName,
              logoUrl: branding?.logoUrl,
              avatarUrl: branding?.avatarUrl,
              avatarSeed: branding?.avatarSeed,
            });
            return (
              <View
                key={`${fleet.orgId}-${fleet.driverId}`}
                style={[
                  styles.fleetCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isDark ? colors.borderSubtle : "rgba(226,232,240,0.9)",
                  },
                ]}
              >
                <View style={styles.fleetTop}>
                  <View style={styles.fleetTopLeft}>
                    <View
                      style={[
                        styles.logo,
                        {
                          backgroundColor: isDark ? colors.surfaceElevated : "rgba(248,250,252,0.92)",
                          borderColor: isDark ? colors.borderSubtle : "rgba(226,232,240,0.9)",
                        },
                      ]}
                    >
                      <Image source={{ uri }} style={styles.logoImage} resizeMode="cover" />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.fleetName, { color: colors.text }]} numberOfLines={1}>
                        {fleet.orgName}
                      </Text>
                      <Text style={[styles.fleetMeta, { color: colors.textMuted }]} numberOfLines={1}>
                        {formatPeriod(fleet.joinedAt, fleet.leftAt)}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.12)",
                        borderColor: isDark ? "rgba(148,163,184,0.35)" : "rgba(148,163,184,0.22)",
                      },
                    ]}
                  >
                    <Text style={[styles.statusText, { color: colors.textMuted }]}>
                      {fleet.isCurrent ? "Linked" : "Past"}
                    </Text>
                  </View>
                </View>

                <View style={styles.statsRow}>
                  <View
                    style={[
                      styles.statBox,
                      {
                        backgroundColor: isDark ? colors.surfaceElevated : "rgba(248,250,252,0.85)",
                        borderColor: isDark ? colors.borderSubtle : "rgba(226,232,240,0.8)",
                      },
                    ]}
                  >
                    <Text style={[styles.statLabel, { color: colors.textMuted }]}>Lifetime earned</Text>
                    <Text style={[styles.statValue, { color: colors.text }]}>{inr(fleet.earned)}</Text>
                    {fleet.tripsCompleted > 0 ? (
                      <Text style={[styles.statHint, { color: colors.emerald }]}>
                        {fleet.tripsCompleted} trip{fleet.tripsCompleted !== 1 ? "s" : ""}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.statBox,
                      {
                        backgroundColor: isDark ? colors.surfaceElevated : "rgba(248,250,252,0.85)",
                        borderColor: isDark ? colors.borderSubtle : "rgba(226,232,240,0.8)",
                        borderLeftWidth: 2,
                        borderLeftColor:
                          fleet.pending > 0
                            ? isDark
                              ? "rgba(251,191,36,0.55)"
                              : Theme.warning
                            : isDark
                              ? colors.borderSubtle
                              : "rgba(226,232,240,0.8)",
                      },
                    ]}
                  >
                    <Text style={[styles.statLabel, { color: colors.textMuted }]}>Pending</Text>
                    <Text
                      style={[
                        styles.statValue,
                        {
                          color: fleet.pending > 0 ? (isDark ? "#fbbf24" : Theme.warning) : colors.textMuted,
                        },
                      ]}
                    >
                      {inr(fleet.pending)}
                    </Text>
                    <Text style={[styles.statHint, { color: colors.textMuted }]}>
                      received {inr(fleet.received)}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.inspectBtn}
                  activeOpacity={0.85}
                  onPress={() => onOpenPassbook(fleet.orgId, fleet.orgName)}
                  accessibilityRole="button"
                  accessibilityLabel={`Inspect ${fleet.orgName}`}
                >
                  <Text style={styles.inspectText}>Inspect fleet center</Text>
                  <FontAwesome name="chevron-right" size={11} color={Theme.textOnPrimary} />
                </TouchableOpacity>
              </View>
            );
          })
        )}

        <Text style={[styles.sectionTitle, { color: colors.textMuted, marginTop: 18 }]}>
          Transactions
        </Text>
        {trips.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: colors.surface,
                borderColor: isDark ? colors.borderSubtle : Theme.borderLight,
              },
            ]}
          >
            <RouteIllustration />
            <Text style={[styles.emptyText, { color: colors.text }]}>
              No fleet trips recorded before conversion.
            </Text>
          </View>
        ) : (
          trips.map((line, idx) => (
            <TouchableOpacity
              key={line.tripId}
              style={[
                styles.tripRow,
                idx < trips.length - 1 && styles.tripRowBorder,
                { borderBottomColor: isDark ? colors.borderSubtle : Theme.borderLight },
              ]}
              activeOpacity={0.82}
              onPress={() => onOpenTrip(line.tripId)}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.tripId, { color: colors.text }]} numberOfLines={1}>
                  {line.displayId}
                </Text>
                <Text style={[styles.tripMeta, { color: colors.textMuted }]} numberOfLines={1}>
                  {line.orgName}
                  {line.route ? ` · ${line.route}` : ""}
                  {line.dateLabel ? ` · ${line.dateLabel}` : ""}
                </Text>
              </View>
              <View style={styles.tripAmts}>
                <Text style={[styles.tripEarned, { color: colors.text }]}>{inr(line.earned)}</Text>
                <Text
                  style={[
                    styles.tripDue,
                    { color: line.pending > 0 ? Theme.warning : colors.textMuted },
                  ]}
                >
                  {line.pending > 0 ? `${inr(line.pending)} due` : "Settled"}
                </Text>
              </View>
              {line.pending > 0 ? (
                <DriverCapturePaymentButton
                  tripId={line.tripId}
                  due={line.pending}
                  lane="fleet"
                  partyName={line.orgName}
                  compact
                  label="Capture commission"
                />
              ) : null}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  title: {
    ...driverUISemiBold,
    fontSize: 16,
    marginTop: 1,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -1.2,
    color: Theme.driverCtaFill,
    textTransform: "uppercase",
  },
  heroSub: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 4,
    marginBottom: 14,
    color: Theme.driverEmeraldMutedText2,
  },
  walletCardWrap: { marginBottom: 8 },
  walletCard: {
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 20,
    overflow: "hidden",
    minHeight: 148,
  },
  walletWatermark: {
    position: "absolute",
    right: 8,
    top: 18,
    opacity: 0.35,
  },
  walletCardContent: {
    alignItems: "flex-start",
    maxWidth: "72%",
  },
  walletLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  walletLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  walletBalanceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    marginTop: 8,
  },
  walletRupee: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 4,
  },
  walletBalance: {
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -1,
  },
  walletBalanceAndroid: { includeFontPadding: false },
  walletPill: {
    marginTop: 14,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  walletSub: {
    fontSize: 11,
    fontWeight: "600",
  },
  sectionTitle: {
    ...driverUISemiBold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  emptyCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  fleetCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  fleetTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fleetTopLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  logoImage: { width: "100%", height: "100%" },
  fleetName: {
    ...driverUISemiBold,
    fontSize: 13,
  },
  fleetMeta: {
    ...driverBodySecondary,
    fontSize: 10,
    marginTop: 2,
  },
  statusPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  statsRow: { flexDirection: "row", gap: 8 },
  statBox: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  statValue: {
    ...driverUISemiBold,
    fontSize: 15,
    marginTop: 2,
  },
  statHint: {
    ...driverBodySecondary,
    fontSize: 10,
    marginTop: 2,
  },
  inspectBtn: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inspectText: {
    fontSize: 12,
    fontWeight: "700",
    color: Theme.textOnPrimary,
  },
  tripRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    minHeight: 52,
  },
  tripRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tripId: {
    ...driverUISemiBold,
    fontSize: 12,
  },
  tripMeta: {
    ...driverBodySecondary,
    fontSize: 10,
    marginTop: 2,
  },
  tripAmts: { alignItems: "flex-end", minWidth: 64 },
  tripEarned: {
    ...driverUISemiBold,
    fontSize: 12,
  },
  tripDue: {
    ...driverBodySecondary,
    fontSize: 10,
    marginTop: 2,
  },
});
