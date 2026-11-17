import Theme from "@/constants/Theme";
import { DriverListEmptyArt } from "@/features/drivers/components/DriverListEmptyArt";
import { IndependentTransactionsEmptyArt } from "@/features/drivers/components/IndependentTransactionsEmptyArt";
import type { DriverWalletTxn } from "@/features/drivers/utils/driverWalletTransactions.util";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    type ImageSourcePropType,
} from "react-native";
import Animated, {
    Easing,
    FadeInDown,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type WalletMenuItem = {
  id: string;
  label: string;
  icon:
    | "money"
    | "briefcase"
    | "building"
    | "road"
    | "file-text-o"
    | "history"
    | "line-chart"
    | "exchange"
    | "plus"
    | "link"
    | "exclamation-circle"
    | "pie-chart"
    | "shopping-bag"
    | "tag"
    | "users"
    | "list";
};

export type WalletMenuGroup = {
  title: string;
  ids: string[];
};

type MenuProps = {
  name: string;
  org: string;
  balance: number;
  /** One plain line under the amount, so the driver knows what it means. */
  balanceCaption: string;
  highlight: number;
  items: WalletMenuItem[];
  groups: WalletMenuGroup[];
  onOpen: (id: string) => void;
  onBack: () => void;
  bottomInset: number;
};

const ROW_HINT: Record<string, string> = {
  "to-collect": "Trips the fleet still has to pay",
  "salary-request": "Ask the fleet for your salary",
  employer: "The fleet you drive for now",
  offline: "Trips you did on your own",
  receivables: "Who still has to pay you",
  career: "Fleets you worked with before",
  earnings: "What you earned on finished trips",
  transactions: "Money that came in and went out",
  "add-party": "Save a customer you collect from",
  history: "Trips from before you were a DCO",
  fleets: "Fleets linked to your account",
  outstanding: "Total money still unpaid",
  collection: "How much of the bill is paid",
  marketplace: "Loads from the marketplace",
  untagged: "Trips with no customer yet",
  tagged: "Customers you already saved",
  ledger: "Cash you handled yourself",
};

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function DriverWalletMenu({
  name,
  org,
  balance,
  balanceCaption,
  highlight,
  items,
  groups,
  onOpen,
  onBack,
  bottomInset,
}: MenuProps) {
  const insets = useSafeAreaInsets();
  const byId = new Map(items.map((item) => [item.id, item]));
  const used = new Set<string>();
  const sections = groups
    .map((group) => {
      const rows = group.ids.flatMap((id) => {
        const item = byId.get(id);
        if (!item) return [];
        used.add(id);
        return [item];
      });
      return { title: group.title, rows };
    })
    .filter((group) => group.rows.length > 0);
  const leftover = items.filter((item) => !used.has(item.id));
  if (leftover.length > 0) sections.push({ title: "More", rows: leftover });
  let rowIndex = 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingBottom: bottomInset + 24,
        paddingHorizontal: 16,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View entering={FadeInDown.duration(280)} style={styles.topRow}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
          <FontAwesome name="chevron-left" size={14} color={Theme.textPrimaryDark} />
        </Pressable>
        <Text style={styles.menuTitle}>Earnings</Text>
        <View style={styles.profile}>
          <Text style={styles.profileName}>{name}</Text>
          {org ? <Text style={styles.profileOrg}>{org}</Text> : null}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(320)} style={styles.balanceCard}>
        <View style={styles.balanceCopy}>
          <Text style={styles.balanceLabel}>Active balance</Text>
          <Text style={styles.balanceAmt}>{inr(balance)}</Text>
          <Text style={styles.balanceHint}>{balanceCaption}</Text>
          {highlight > 0 ? (
            <Text style={styles.balanceIn}>Last money in  +{inr(highlight)}</Text>
          ) : null}
        </View>
        {balance === 0 && highlight === 0 ? <DriverListEmptyArt kind="money" /> : null}
      </Animated.View>

      {sections.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.list}>
            {group.rows.map((item) => {
              const delay = Math.min(rowIndex, 8) * 40;
              rowIndex += 1;
              const hint = ROW_HINT[item.id];
              return (
                <Animated.View key={item.id} entering={FadeInDown.delay(delay).duration(320)}>
                  <Pressable
                    onPress={() => onOpen(item.id)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={hint ? `${item.label}. ${hint}` : item.label}
                  >
                    <View style={styles.rowIcon}>
                      <FontAwesome name={item.icon} size={15} color={Theme.driverCtaFill} />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowLabel}>{item.label}</Text>
                      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
                    </View>
                    <FontAwesome name="chevron-right" size={12} color={Theme.textMuted} />
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const EMPTY_COPY: Record<string, { title: string; body: string; image: ImageSourcePropType }> = {
  employer: {
    title: "No fleet yet",
    body: "The fleet you drive for will show here.",
    image: require("../../../assets/images/no-org-linked.png"),
  },
  offline: {
    title: "No offline trips yet",
    body: "Trips you do on your own will show here.",
    image: require("../../../assets/images/offline-road-icon.png"),
  },
  career: {
    title: "No past fleets",
    body: "Fleets you leave will stay here.",
    image: require("../../../assets/images/fleet-empty-van.png"),
  },
  fleets: {
    title: "No linked fleets",
    body: "A fleet that links you will show here.",
    image: require("../../../assets/images/no-org-linked.png"),
  },
  marketplace: {
    title: "No marketplace loads",
    body: "Loads you take from the marketplace show here.",
    image: require("../../../assets/images/receivables-van-parcel.png"),
  },
  untagged: {
    title: "No untagged trips",
    body: "Trips with no customer yet show here.",
    image: require("../../../assets/images/receivables-van-parcel.png"),
  },
  tagged: {
    title: "No saved customers",
    body: "Customers you tag on a trip show here.",
    image: require("../../../assets/images/receivables-van-parcel.png"),
  },
  receivables: {
    title: "Nothing to collect yet",
    body: "When someone owes you, it shows here.",
    image: require("../../../assets/images/receivables-van-parcel.png"),
  },
};

export function WalletEmptyState({ kind }: { kind: keyof typeof EMPTY_COPY }) {
  const copy = EMPTY_COPY[kind];
  return (
    <Animated.View entering={FadeInDown.duration(320)} style={styles.emptyCard}>
      <Image source={copy.image} style={styles.emptyImage} resizeMode="contain" accessibilityIgnoresInvertColors />
      <Text style={styles.emptyTitle}>{copy.title}</Text>
      <Text style={styles.emptyBody}>{copy.body}</Text>
    </Animated.View>
  );
}

export function WalletEnter({ children, index = 0 }: { children: ReactNode; index?: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(320)}>
      {children}
    </Animated.View>
  );
}

const SECTION_TITLES: Record<string, string> = {
  employer: "Current employer",
  offline: "Offline trips",
  receivables: "Receivable history",
  career: "Career history",
  earnings: "Earnings",
  transactions: "Transactions History",
  history: "History",
  fleets: "Linked fleets",
  outstanding: "Total outstanding",
  collection: "Collection",
  marketplace: "Marketplace",
  untagged: "Untagged",
  tagged: "Tagged shippers",
  ledger: "Self-transactions",
};

const SECTION_HELP: Record<string, string> = {
  employer: "The fleet you drive for now.",
  offline: "Trips you did on your own.",
  receivables: "Who still has to pay you.",
  career: "Fleets you worked with before.",
  earnings: "What you earned on finished trips.",
  transactions: "Money that came in and went out.",
  history: "Trips from before you were a DCO.",
  fleets: "Fleets linked to your account.",
  outstanding: "Total money still unpaid.",
  collection: "How much of the bill is already paid.",
  marketplace: "Loads from the marketplace.",
  untagged: "Trips that still need a customer.",
  tagged: "Customers you already saved.",
  ledger: "Cash you handled yourself.",
};

export function walletSectionTitle(id: string): string {
  return SECTION_TITLES[id] ?? "Wallet";
}

export function walletSectionHelp(id: string): string {
  return SECTION_HELP[id] ?? "";
}

const PAGE_MARK: Record<string, { icon: WalletMenuItem["icon"]; image?: ImageSourcePropType }> = {
  employer: { icon: "building" },
  offline: { icon: "road", image: require("../../../assets/images/offline-road-icon.png") },
  receivables: { icon: "file-text-o", image: require("../../../assets/images/receivables-van-parcel.png") },
  career: { icon: "history", image: require("../../../assets/images/available-truck.png") },
  earnings: { icon: "line-chart", image: require("../../../assets/images/available-truck.png") },
  transactions: { icon: "exchange" },
  history: { icon: "history", image: require("../../../assets/images/available-truck.png") },
  fleets: { icon: "link", image: require("../../../assets/images/fleet-empty-van.png") },
  outstanding: { icon: "exclamation-circle", image: require("../../../assets/images/receivables-van-parcel.png") },
  collection: { icon: "pie-chart" },
  marketplace: { icon: "shopping-bag", image: require("../../../assets/images/receivables-van-parcel.png") },
  untagged: { icon: "tag" },
  tagged: { icon: "users" },
  ledger: { icon: "list" },
};

function FloatingPageArt({ source }: { source: ImageSourcePropType }) {
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [lift]);
  const artStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value * -7 }],
  }));
  return (
    <Animated.View style={artStyle} pointerEvents="none">
      <Image source={source} style={styles.pageArt} resizeMode="contain" accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

export function DriverWalletSectionFrame({
  title,
  subtitle,
  stat,
  section,
  onBack,
  bottomInset,
  children,
}: {
  title: string;
  subtitle?: string;
  stat?: string;
  section?: string;
  onBack: () => void;
  bottomInset: number;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const mark = PAGE_MARK[section ?? ""] ?? { icon: "money" as const };
  return (
    <LinearGradient
      colors={[Theme.driverCtaFill, Theme.driverEmerald]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.stage}
    >
      <Animated.View entering={FadeInDown.duration(280)} style={[styles.stageHead, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.stageBack} accessibilityRole="button" accessibilityLabel="Back to Earnings">
          <FontAwesome name="chevron-left" size={14} color={Theme.driverCtaFill} />
        </Pressable>
        <View style={styles.stageCopy}>
          <Text style={styles.stageTitle}>{title}</Text>
          {subtitle ? <Text style={styles.stageHelp}>{subtitle}</Text> : null}
          {stat ? <Text style={styles.stageStat}>{stat}</Text> : null}
        </View>
        {mark.image ? (
          <FloatingPageArt source={mark.image} />
        ) : (
          <View style={styles.stageIcon}>
            <FontAwesome name={mark.icon} size={22} color={Theme.driverCtaFill} />
          </View>
        )}
      </Animated.View>
      <ScrollView
        style={styles.stageScroll}
        contentContainerStyle={{ paddingBottom: bottomInset + 28 }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.delay(80).duration(340)} style={styles.stageSheet}>
          {children}
        </Animated.View>
      </ScrollView>
    </LinearGradient>
  );
}

type Range = "all" | "week" | "month";

function startOfRange(range: Range): number | null {
  if (range === "all") return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "week") start.setDate(start.getDate() - 6);
  else start.setDate(1);
  return start.getTime();
}

export function DriverWalletTransactionsDetail({
  rows,
  clearedPercent,
  onOpen,
}: {
  rows: DriverWalletTxn[];
  clearedPercent: number;
  onOpen: (txn: DriverWalletTxn) => void;
}) {
  const [range, setRange] = useState<Range>("all");
  const [filtering, setFiltering] = useState(false);
  const [query, setQuery] = useState("");

  const monthRows = useMemo(() => {
    const now = new Date();
    return rows.filter((row) => {
      const at = new Date(row.at);
      return at.getMonth() === now.getMonth() && at.getFullYear() === now.getFullYear();
    });
  }, [rows]);

  const visible = useMemo(() => {
    const from = startOfRange(range);
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (from != null && new Date(row.at).getTime() < from) return false;
      if (!q) return true;
      return `${row.title} ${row.subtitle} ${row.tripRef}`.toLowerCase().includes(q);
    });
  }, [query, range, rows]);

  const monthTotal = monthRows.reduce((sum, row) => sum + (row.kind === "in" ? row.amount : 0), 0);
  const monthName = new Date().toLocaleDateString("en-IN", { month: "short" });

  return (
    <View style={{ gap: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {(
          [
            ["all", "All History"],
            ["week", "This Week"],
            ["month", "This Month"],
          ] as const
        ).map(([id, label]) => {
          const active = range === id;
          return (
            <Pressable key={id} onPress={() => setRange(id)} style={[styles.pill, active && styles.pillOn]}>
              <Text style={[styles.pillText, active && styles.pillTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setFiltering((open) => !open)} style={[styles.pill, filtering && styles.pillOn]}>
          <FontAwesome name="filter" size={12} color={filtering ? Theme.driverCtaFill : Theme.textSecondary} />
          <Text style={[styles.pillText, filtering && styles.pillTextOn]}>Filter</Text>
        </Pressable>
      </ScrollView>
      {filtering ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search trip or party"
          placeholderTextColor={Theme.textMuted}
          style={styles.search}
          autoCorrect={false}
        />
      ) : null}

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Current month ({monthName})</Text>
          <Text style={styles.statAmt}>{inr(monthTotal)}</Text>
          <Text style={styles.statHint}>{inr(monthTotal)} • {monthRows.length} trip{monthRows.length === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Receivables cleared</Text>
          <Text style={styles.statPct}>{clearedPercent}%</Text>
        </View>
      </View>

      {visible.length === 0 ? (
        <View style={styles.txnEmpty}>
          <IndependentTransactionsEmptyArt />
          <Text style={styles.emptyTitle}>No transactions in this view</Text>
          <Text style={styles.emptyBody}>Try another date, or clear the search.</Text>
        </View>
      ) : (
        visible.map((txn, index) => {
          const when = new Date(txn.at).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const ref = txn.tripRef && txn.tripRef !== "Trip" ? txn.tripRef : "";
          const paid = txn.kind === "in";
          return (
            <Animated.View key={txn.id} entering={FadeInDown.delay(Math.min(index, 8) * 35).duration(280)}>
            <Pressable onPress={() => onOpen(txn)} style={[styles.txnCard, { borderLeftColor: paid ? Theme.driverCtaFill : Theme.borderMedium }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.txnMeta}>
                  {when}{ref ? ` • ${ref}` : ""}
                </Text>
                <Text style={styles.txnTitle}>{txn.title}</Text>
              </View>
              <View style={styles.txnRight}>
                <Text style={[styles.txnAmt, { color: paid ? Theme.driverCtaFill : Theme.textSecondary }]}>
                  {paid ? "+" : "-"}{inr(txn.amount)}
                </Text>
                <View style={[styles.statusPill, { backgroundColor: paid ? Theme.driverEmeraldMuted : Theme.surfaceGray }]}>
                  <Text style={[styles.statusText, { color: paid ? Theme.driverCtaFill : Theme.textSecondary }]}>
                    {paid ? "Paid" : "Expense"}
                  </Text>
                </View>
              </View>
            </Pressable>
            </Animated.View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.driverHeaderPanel },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
  },
  menuTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: Theme.textPrimaryDark, letterSpacing: -0.3 },
  profile: { maxWidth: 140, alignItems: "flex-end", flexShrink: 1 },
  profileName: { fontSize: 13, fontWeight: "700", color: Theme.textPrimaryDark, textAlign: "right" },
  profileOrg: { fontSize: 10, fontWeight: "600", color: Theme.textMuted, marginTop: 1, textAlign: "right" },
  balanceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.cardWhite,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    padding: 16,
    marginBottom: 14,
    gap: 12,
  },
  balanceCopy: { flex: 1, minWidth: 0 },
  balanceLabel: { fontSize: 12, fontWeight: "600", color: Theme.textMuted },
  balanceAmt: { marginTop: 4, fontSize: 28, fontWeight: "800", color: Theme.textPrimaryDark, letterSpacing: -0.6 },
  balanceHint: { marginTop: 6, fontSize: 13, lineHeight: 18, color: Theme.textSecondary },
  balanceIn: { marginTop: 8, fontSize: 13, fontWeight: "700", color: Theme.driverCtaFill },
  group: { marginTop: 8, marginBottom: 6 },
  groupTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.textMuted,
    marginBottom: 8,
    marginLeft: 4,
  },
  list: { gap: 8 },
  row: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: Theme.cardWhite,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowPressed: { opacity: 0.82 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Theme.driverEmeraldMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: "700", color: Theme.textPrimaryDark },
  rowHint: { fontSize: 12, lineHeight: 16, color: Theme.textSecondary },
  stage: { flex: 1 },
  stageHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 22,
  },
  stageBack: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
  },
  stageCopy: { flex: 1, minWidth: 0, paddingTop: 2 },
  stageTitle: { fontSize: 26, fontWeight: "800", color: Theme.cardWhite, letterSpacing: -0.5 },
  stageHelp: { marginTop: 4, fontSize: 14, lineHeight: 20, color: Theme.cardWhite, opacity: 0.88 },
  stageStat: { marginTop: 10, fontSize: 22, fontWeight: "800", color: Theme.cardWhite, letterSpacing: -0.4 },
  stageIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
  },
  pageArt: { width: 96, height: 78 },
  stageScroll: {
    flex: 1,
    backgroundColor: Theme.driverHeaderPanel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  stageSheet: { paddingHorizontal: 16, paddingTop: 18, gap: 12 },
  sectionHead: { paddingHorizontal: 16, paddingBottom: 8 },
  sectionBack: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36 },
  sectionBackText: { fontSize: 14, fontWeight: "600", color: Theme.textPrimaryDark },
  sectionTitle: { marginTop: 6, fontSize: 26, fontWeight: "800", color: Theme.textPrimaryDark, letterSpacing: -0.5 },
  sectionHelp: { marginTop: 4, fontSize: 14, lineHeight: 20, color: Theme.textSecondary },
  emptyCard: { alignItems: "center", paddingVertical: 28, paddingHorizontal: 12, gap: 8 },
  emptyImage: { width: 140, height: 110 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: Theme.textPrimaryDark, textAlign: "center" },
  emptyBody: { fontSize: 13, lineHeight: 18, color: Theme.textSecondary, textAlign: "center" },
  txnEmpty: { alignItems: "center", paddingTop: 12, gap: 8 },
  pills: { gap: 8, paddingVertical: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: Theme.cardWhite,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
  },
  pillOn: { backgroundColor: Theme.driverEmeraldMuted, borderColor: Theme.driverEmeraldBorderSoft },
  pillText: { fontSize: 13, fontWeight: "600", color: Theme.textSecondary },
  pillTextOn: { color: Theme.driverCtaFill, fontWeight: "700" },
  search: {
    height: 42,
    borderRadius: 12,
    backgroundColor: Theme.cardWhite,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    paddingHorizontal: 12,
    color: Theme.textPrimaryDark,
    fontSize: 14,
  },
  statRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: Theme.cardWhite,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    padding: 14,
    minHeight: 108,
  },
  statLabel: { fontSize: 12, fontWeight: "600", color: Theme.textMuted },
  statAmt: { marginTop: 8, fontSize: 22, fontWeight: "800", color: Theme.textPrimaryDark, letterSpacing: -0.4 },
  statHint: { marginTop: 4, fontSize: 12, color: Theme.textSecondary },
  statPct: { marginTop: 10, fontSize: 28, fontWeight: "800", color: Theme.driverCtaFill, letterSpacing: -0.6 },
  txnCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Theme.cardWhite,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.borderLight,
    borderLeftWidth: 3,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  txnMeta: { fontSize: 12, color: Theme.textMuted, fontWeight: "600" },
  txnTitle: { marginTop: 3, fontSize: 15, fontWeight: "700", color: Theme.textPrimaryDark },
  txnRight: { alignItems: "flex-end", gap: 6 },
  txnAmt: { fontSize: 15, fontWeight: "800" },
  statusPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: "700" },
});
