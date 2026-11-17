/**
 * Idle dashboard for drivers who are not on the DCO available surface.
 * Same visual layout as that home. Actions stay on the existing driver flow:
 * go online, go offline, trips, earnings, salary, and notifications.
 */
import { DriverBrandMark } from '@/components/driver/DriverBrandMark';
import { DriverSelfAvatar } from '@/components/driver/DriverSelfAvatar';
import Layout from '@/constants/Layout';
import Theme from '@/constants/Theme';
import Typography from '@/constants/Typography';
import { useOptionalLanguage } from '@/contexts/LanguageContext';
import { useDriverTheme, useDriverThemeColors } from '@/contexts/DriverThemeContext';
import { useOptionalDriverChat } from '@/features/chat/contexts/DriverChatContext';
import type { TripConversation } from '@/features/chat/types/chat.types';
import { ROUTES } from '@/lib/routes';
import { useFocusEffect } from '@react-navigation/native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  Bell,
  ChevronRight,
  History,
  MessageSquare,
  Power,
  Receipt,
  Wallet,
  Wifi,
} from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useMemo } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

const AVAILABLE_TRUCK = require('../../../assets/images/available-truck.png') as number;

const SHORTCUT_FACES: ReadonlyArray<{
  colors: readonly [string, string];
  icon: string;
}> = [
  { colors: [Theme.driverEmeraldDark, Theme.driverEmerald], icon: Theme.cardWhite },
  { colors: [Theme.driverCtaFill, Theme.driverEmeraldDark], icon: Theme.cardWhite },
  { colors: [Theme.driverPrimary, Theme.tripsMint], icon: Theme.cardWhite },
  { colors: [Theme.tripsCardWashMid, Theme.cardWhite], icon: Theme.driverCtaFill },
];

type Props = {
  avatarUri: string;
  driverName: string;
  isOnline: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onGoOnline: () => void;
  onGoOffline: () => void;
  children?: ReactNode;
};

function HeroContours() {
  const line = Theme.cardWhite;
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 340 180"
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Path
        d="M-24 132 C 36 88, 78 156, 142 104 S 236 36, 364 92"
        stroke={line}
        strokeOpacity={0.2}
        strokeWidth={1.25}
        fill="none"
      />
      <Path
        d="M-24 152 C 48 112, 96 168, 158 124 S 258 62, 364 112"
        stroke={line}
        strokeOpacity={0.13}
        strokeWidth={1}
        fill="none"
      />
      <Path
        d="M210 -8 C 186 36, 248 52, 228 96 S 186 150, 268 188"
        stroke={line}
        strokeOpacity={0.16}
        strokeWidth={1.1}
        fill="none"
      />
    </Svg>
  );
}

function AvailableTruckArt() {
  const enter = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) });
    bob.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [bob, enter]);

  const truckStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: bob.value * -2.5 }],
  }));

  return (
    <View style={styles.truckStage} pointerEvents="none" accessibilityElementsHidden>
      <Animated.View style={truckStyle}>
        <Image
          source={AVAILABLE_TRUCK}
          style={styles.truckImage}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
    </View>
  );
}

function GrowWave() {
  return (
    <Svg width={148} height={72} style={styles.growWave} pointerEvents="none">
      <Path
        d="M0 50 C 22 50, 30 26, 52 26 S 78 54, 100 34 S 126 14, 148 22"
        stroke={Theme.tripsMint}
        strokeOpacity={0.7}
        strokeWidth={2}
        fill="none"
      />
      <Path
        d="M0 60 C 26 60, 38 42, 60 42 S 88 62, 112 46 S 132 32, 148 36"
        stroke={Theme.driverEmerald}
        strokeOpacity={0.35}
        strokeWidth={1.5}
        fill="none"
      />
    </Svg>
  );
}

function ActivityArt() {
  return (
    <Svg width={52} height={52} viewBox="0 0 52 52">
      <Circle cx="20" cy="28" r="14" fill={Theme.driverEmeraldMuted} />
      <Circle cx="32" cy="20" r="12" fill={Theme.tripsMint} fillOpacity={0.85} />
      <Circle cx="26" cy="32" r="9" fill={Theme.driverEmerald} fillOpacity={0.55} />
    </Svg>
  );
}

export function DriverFleetHome({
  avatarUri,
  driverName,
  isOnline,
  refreshing,
  onRefresh,
  onGoOnline,
  onGoOffline,
  children,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useDriverTheme();
  const colors = useDriverThemeColors();
  const isDark = theme === 'dark';
  const { localeOptions, locale } = useOptionalLanguage();
  const chat = useOptionalDriverChat();
  const page = isDark ? colors.background : Theme.driverEmeraldWash;
  const ink = isDark ? colors.text : Theme.driverCtaFill;
  const languageCode = (localeOptions.find((option) => option.value === locale)?.label ?? 'EN')
    .slice(0, 2)
    .toUpperCase();
  const chipBg = isDark ? colors.surface : Theme.cardWhite;
  const chipBorder = isDark ? colors.border : Theme.borderMedium;

  const refreshConversations = chat?.refreshConversations;
  useFocusEffect(
    useCallback(() => {
      void refreshConversations?.();
    }, [refreshConversations]),
  );

  const recentUpdates = useMemo(() => {
    const rows = chat?.conversations ?? [];
    return rows
      .filter((row) => (row.last_message_preview ?? '').trim().length > 0)
      .slice()
      .sort((a, b) =>
        String(b.last_message_at ?? b.updated_at).localeCompare(
          String(a.last_message_at ?? a.updated_at),
        ),
      )
      .slice(0, 3);
  }, [chat?.conversations]);

  const openChat = (tripId?: string) => {
    if (tripId) {
      router.push(`/(driver)/chat?tripId=${encodeURIComponent(tripId)}`);
      return;
    }
    router.push('/(driver)/chat');
  };

  const updateTitle = (row: TripConversation) => {
    const trip = row.trip_number?.trim();
    const party = row.party_name?.trim();
    if (trip && party) return `${trip} · ${party}`;
    return trip || party || 'Trip update';
  };

  const shortcuts = [
    {
      key: 'trips',
      label: 'Trips',
      icon: History,
      onPress: () => router.push('/(driver)/trip-history'),
    },
    {
      key: 'earnings',
      label: 'Earnings',
      icon: Wallet,
      onPress: () => router.push('/(driver)/wallet'),
    },
    {
      key: 'salary',
      label: 'Salary',
      icon: Receipt,
      onPress: () => router.push('/(driver)/pending-earnings'),
    },
    {
      key: 'alerts',
      label: 'Alerts',
      icon: Bell,
      onPress: () => router.push('/(driver)/notifications'),
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: page }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + Layout.tabBarHeight + 28,
          paddingHorizontal: Layout.screenPaddingHorizontal,
          gap: 18,
        }}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.push('/(driver)/profile')}
            style={styles.avatarBtn}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
          >
            <DriverSelfAvatar size={44} uri={avatarUri} borderColor={colors.emerald} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <DriverBrandMark color={colors.textMuted} />
            <Text style={[styles.welcomeTitle, { color: ink }]} numberOfLines={1}>
              {driverName ? `Hi, ${driverName}` : 'Home'}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() =>
                router.push(ROUTES.MODALS.LANGUAGE_SETTINGS as Parameters<typeof router.push>[0])
              }
              style={[styles.languageBtn, { backgroundColor: chipBg, borderColor: chipBorder }]}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Language"
            >
              <FontAwesome name="globe" size={13} color={ink} />
              <Text style={[styles.languageCode, { color: ink }]}>{languageCode}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openChat()}
              style={[styles.iconBtn, { backgroundColor: chipBg, borderColor: chipBorder }]}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Trip messages"
            >
              <MessageSquare size={16} color={ink} strokeWidth={2.25} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/(driver)/notifications')}
              style={[styles.iconBtn, { backgroundColor: chipBg, borderColor: chipBorder }]}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <Bell size={16} color={ink} strokeWidth={2.2} />
              <View style={styles.bellDot} />
            </TouchableOpacity>
          </View>
        </View>

        {children}

        <LinearGradient
          colors={
            isDark
              ? [Theme.driverEmeraldDark, colors.surface]
              : [Theme.driverCtaFill, Theme.driverEmeraldDark]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statusCard}
        >
          <HeroContours />
          <View style={styles.statusTop}>
            <View style={styles.statusCopy}>
              <Text style={styles.statusTitle}>
                {isOnline ? 'No trips available' : 'You are currently offline'}
              </Text>
              <Text style={styles.statusBody}>
                {isOnline
                  ? 'We’re looking for trips in your area.'
                  : 'Go online to view and accept trip assignments.'}
              </Text>
            </View>
            <AvailableTruckArt />
          </View>
          <TouchableOpacity
            style={styles.primaryAction}
            activeOpacity={0.88}
            onPress={isOnline ? onGoOffline : onGoOnline}
            accessibilityRole="button"
            accessibilityLabel={isOnline ? 'Go offline' : 'Go online'}
          >
            {isOnline ? (
              <Power size={16} color={Theme.driverCtaFill} strokeWidth={2.4} />
            ) : (
              <Wifi size={16} color={Theme.driverCtaFill} strokeWidth={2.4} />
            )}
            <Text style={styles.primaryActionText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
            <ChevronRight size={16} color={Theme.driverCtaFill} strokeWidth={2.4} />
          </TouchableOpacity>
        </LinearGradient>

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: ink }]}>Quick Access</Text>
        </View>
        <View style={styles.shortcutRow}>
          {shortcuts.map((item, index) => {
            const Icon = item.icon;
            const face = SHORTCUT_FACES[index] ?? SHORTCUT_FACES[0];
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.shortcut}
                onPress={item.onPress}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <LinearGradient
                  colors={face.colors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[
                    styles.shortcutTile,
                    index === shortcuts.length - 1 && styles.shortcutTileLight,
                  ]}
                >
                  <Icon size={20} color={face.icon} strokeWidth={2.2} />
                </LinearGradient>
                <Text style={[styles.shortcutLabel, { color: ink }]} numberOfLines={1}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[
            styles.growCard,
            {
              backgroundColor: isDark ? colors.surface : Theme.cardWhite,
              borderColor: isDark ? colors.border : Theme.borderMedium,
            },
          ]}
          activeOpacity={0.88}
          onPress={() => router.push('/(driver)/wallet')}
          accessibilityRole="button"
          accessibilityLabel="Grow your business"
        >
          <GrowWave />
          <View style={[styles.growIcon, { backgroundColor: Theme.driverEmeraldMuted }]}>
            <Wallet size={18} color={Theme.driverCtaFill} strokeWidth={2.2} />
          </View>
          <View style={styles.growCopy}>
            <Text style={[styles.growTitle, { color: ink }]}>Grow your business</Text>
            <Text style={[styles.growBody, { color: colors.textMuted }]}>
              Track performance & earnings
            </Text>
          </View>
          <ChevronRight size={16} color={Theme.driverEmerald} />
        </TouchableOpacity>

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: ink }]}>Recent Activity</Text>
          <TouchableOpacity
            onPress={() => router.push('/(driver)/trip-history')}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.viewAll}>View all</Text>
          </TouchableOpacity>
        </View>
        {recentUpdates.length > 0 ? (
          recentUpdates.map((row) => (
            <TouchableOpacity
              key={row.id}
              style={[styles.activityCard, { backgroundColor: chipBg, borderColor: chipBorder }]}
              activeOpacity={0.88}
              onPress={() => openChat(row.trip_id)}
              accessibilityRole="button"
              accessibilityLabel={updateTitle(row)}
            >
              <View style={[styles.growIcon, { backgroundColor: Theme.driverEmeraldMuted }]}>
                <MessageSquare size={16} color={Theme.driverCtaFill} strokeWidth={2.2} />
              </View>
              <View style={styles.growCopy}>
                <Text style={[styles.growTitle, { color: ink }]} numberOfLines={1}>
                  {updateTitle(row)}
                </Text>
                <Text style={[styles.growBody, { color: colors.textMuted }]} numberOfLines={2}>
                  {row.last_message_preview?.trim()}
                </Text>
              </View>
              <ChevronRight size={16} color={Theme.driverEmerald} />
            </TouchableOpacity>
          ))
        ) : (
          <View style={[styles.activityCard, { backgroundColor: chipBg, borderColor: chipBorder }]}>
            <ActivityArt />
            <View style={styles.growCopy}>
              <Text style={[styles.growTitle, { color: ink }]}>No active trips right now</Text>
              <Text style={[styles.growBody, { color: colors.textMuted }]}>
                Fresh assignments appear here instantly once dispatched.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  languageBtn: {
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  languageCode: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Theme.negative,
    borderWidth: 1,
    borderColor: Theme.cardWhite,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  avatarBtn: { padding: 0 },
  welcomeTitle: {
    ...Typography.headerTitle,
    textTransform: 'none',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  statusCard: {
    borderRadius: 24,
    padding: 18,
    gap: 16,
    overflow: 'hidden',
    shadowColor: Theme.driverCtaFill,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 4,
  },
  truckStage: {
    width: 120,
    height: 68,
    marginTop: 10,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  truckImage: {
    width: 120,
    height: 68,
  },
  statusTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 88,
  },
  statusCopy: { flex: 1, minWidth: 0, gap: 6 },
  statusTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: Theme.textOnPrimary,
  },
  statusBody: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    color: Theme.textOnPrimary,
    opacity: 0.86,
  },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 24,
    alignSelf: 'stretch',
    backgroundColor: Theme.cardWhite,
  },
  primaryActionText: {
    fontSize: 15,
    fontWeight: '800',
    color: Theme.driverCtaFill,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  viewAll: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.driverCtaFill,
  },
  shortcutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  shortcut: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  shortcutTile: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.cardWhite,
  },
  shortcutTileLight: {
    borderColor: Theme.driverEmeraldBorderSoft,
  },
  shortcutLabel: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  growCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    overflow: 'hidden',
  },
  growWave: {
    position: 'absolute',
    right: 8,
    bottom: 0,
  },
  growIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  growCopy: { flex: 1, minWidth: 0, gap: 2 },
  growTitle: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  growBody: { fontSize: 12, lineHeight: 16 },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
});
