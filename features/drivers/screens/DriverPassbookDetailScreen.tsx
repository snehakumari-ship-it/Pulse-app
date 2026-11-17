/**
 * Passbook detail — trip and revenue details for one fleet (organization).
 * Data from trips + driver_ledger for the current user's driver link to this org.
 */
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { DriverLedgerReceiptPreviewModal, type DriverLedgerReceiptPreview } from "@/features/drivers/components/DriverLedgerReceiptPreviewModal";
import { DriverListEmptyArt } from "@/features/drivers/components/DriverListEmptyArt";
import { DriverCapturePaymentButton } from "@/features/drivers/components/DriverCapturePaymentButton";
import {
  buildDriverLedgerReceiptDetails,
  deriveDriverPaymentMode,
} from "@/features/driver/tripSettlement/driverTripSettlement.util";
import { FinanceTxnTypography } from '@/constants/FinanceTxnTypography';
import Layout from '@/constants/Layout';
import Theme from '@/constants/Theme';
import Typography from '@/constants/Typography';
import { SearchBar } from '@/components/SearchBar';
import { ThemedConfirmModal } from '@/components/ThemedConfirmModal';
import { useAuth } from '@/contexts/AuthContext';
import { useDriverTheme, useDriverThemeColors } from '@/contexts/DriverThemeContext';
import {
  buildBulkTripClaimWhatsappMessage,
  buildSettlementShareMessage,
} from '@/features/driver/utils/driverCommunication.util';
import { phonePeMetaDate } from '@/features/driver/utils/driverGpayTransactions.util';
import {
  isAggregateTrip,
  resolveDriverTripPayoutTerms,
  tripEarningsDetailForDriver,
  tripEarningsForDriver,
} from '@/features/drivers/utils/driverUtils.util';
import { buildCompensationSalaryLines, buildDriverInviteSalaryLines } from '@/features/drivers/utils/driverInviteOffer.util';
import { resolveDriverOrgAvatarUri } from '@/features/drivers/utils/resolveDriverOrgAvatar.util';
import {
  buildDriverTripNumberMap,
  getDriverTripDisplayNumber,
} from '@/features/driver/utils/driverTripSequence.util';
import { useOrgBrandingByIds } from '@/lib/hooks/useOrgBrandingByIds';
import { usePreventScreenCapture } from '@/lib/usePreventScreenCapture';
import * as driversService from '@/features/drivers/services/drivers.service';
import * as salaryRequestsService from '@/features/drivers/services/salaryRequests.service';
import * as tripsService from '@/features/trips/services/trips.service';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import Svg, { Path } from 'react-native-svg';
import { injectPulseWatermarkIntoHtml } from '@/lib/reportWatermark.util';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    
    Image,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function formatTransactionDateSection(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dDate = d.getDate();
  const dMonth = d.getMonth();
  const dYear = d.getFullYear();
  if (dDate === today.getDate() && dMonth === today.getMonth() && dYear === today.getFullYear())
    return 'Today';
  if (dDate === yesterday.getDate() && dMonth === yesterday.getMonth() && dYear === yesterday.getFullYear())
    return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function extractUtr(raw?: string | null): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/\bUTR\b\s*[:=]?\s*([0-9A-Za-z-]{8,24})\b/i);
  return m?.[1] ?? null;
}

function buildCashReceiptHtml(p: {
  title: string;
  amount: number;
  transactionId: string;
  utr: string;
  paymentMode: string;
  capturedAt: string;
  reference: string;
  settledTo: string;
  route?: string | null;
}) {
  const {
    title,
    amount,
    transactionId,
    utr,
    paymentMode,
    capturedAt,
    reference,
    settledTo,
    route,
  } = p;
  const safe = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial; margin: 0; color: #0f172a; }
      .page { padding: 24px; }
      .card { border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; }
      .hero { padding: 28px 22px 20px; text-align: center; background: #f8fafc; }
      .check { width: 64px; height: 64px; border-radius: 999px; background: #dcfce7; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px; }
      .check svg { width: 30px; height: 30px; color: #16a34a; }
      .eyebrow { font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: #16a34a; margin-bottom: 10px; }
      .amount { font-size: 44px; font-weight: 700; letter-spacing: -0.04em; margin: 0; }
      .divider { border-top: 1px dashed #e2e8f0; }
      .rows { padding: 18px 18px 10px; }
      .row { display: flex; justify-content: space-between; gap: 14px; padding: 10px 0; }
      .k { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #64748b; min-width: 120px; }
      .v { font-size: 14px; font-weight: 600; color: #0f172a; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .footer { padding: 16px 18px 18px; font-size: 11px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="card">
        <div class="hero">
          <div class="check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="eyebrow">${safe(title)}</div>
          <p class="amount">₹${Math.round(amount).toLocaleString('en-IN')}</p>
        </div>
        <div class="divider"></div>
        <div class="rows">
          <div class="row"><div class="k">Transaction ID</div><div class="v">${safe(transactionId)}</div></div>
          <div class="row"><div class="k">UTR</div><div class="v">${safe(utr)}</div></div>
          <div class="row"><div class="k">Payment mode</div><div class="v">${safe(paymentMode)}</div></div>
          <div class="row"><div class="k">Captured at</div><div class="v">${safe(capturedAt)}</div></div>
          <div class="row"><div class="k">Reference</div><div class="v">${safe(reference)}</div></div>
          <div class="row"><div class="k">Settled to</div><div class="v">${safe(settledTo)}</div></div>
          ${route ? `<div class="row"><div class="k">Route</div><div class="v">${safe(route)}</div></div>` : ``}
        </div>
        <div class="footer">Generated from Pulse Driver · ${safe(capturedAt)}</div>
      </div>
    </div>
  </body>
</html>`;
}

function buildBulkClaimHtml(p: {
  driverName?: string | null;
  driverPhone?: string | null;
  generatedAt: string;
  groups: {
    fleetName: string;
    total: number;
    trips: { displayId: string; amount: number; date: string; route: string; status: string }[];
  }[];
}) {
  const safe = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  const driverLine = [p.driverName?.trim() || null, p.driverPhone?.trim() || null].filter(Boolean).join(' · ');
  const groupsHtml = p.groups
    .map((g) => {
      const tripsHtml = g.trips
        .map(
          (t) => `
            <div class="trip">
              <div class="tripTop">
                <div class="tripId">${safe(t.displayId)}</div>
                <div class="tripAmt">₹${Math.round(t.amount).toLocaleString('en-IN')}</div>
              </div>
              <div class="tripMeta">${safe(t.date)} · ${safe(t.status)}</div>
              <div class="tripRoute">${safe(t.route)}</div>
            </div>`,
        )
        .join('');
      return `
          <div class="group">
            <div class="groupHead">
              <div class="groupName">${safe(g.fleetName)}</div>
              <div class="groupTotal">₹${Math.round(g.total).toLocaleString('en-IN')}</div>
            </div>
            ${tripsHtml}
          </div>`;
    })
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial; margin: 0; color: #0f172a; background: #ffffff; }
      .page { padding: 22px; }
      .hero { border: 1px solid #e2e8f0; border-radius: 18px; padding: 18px; background: #0b1220; color: #fff; }
      .eyebrow { font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: rgba(255,255,255,0.65); margin-bottom: 10px; }
      .title { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
      .sub { font-size: 12px; color: rgba(255,255,255,0.62); margin: 0; }
      .group { margin-top: 16px; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; }
      .groupHead { display:flex; justify-content: space-between; gap: 14px; padding: 14px 16px; background: #f8fafc; border-bottom: 1px dashed #e2e8f0; }
      .groupName { font-size: 13px; font-weight: 700; }
      .groupTotal { font-size: 14px; font-weight: 800; color: #fb923c; }
      .trip { padding: 12px 16px; border-bottom: 1px solid #eef2f7; }
      .trip:last-child { border-bottom: 0; }
      .tripTop { display:flex; justify-content: space-between; gap: 12px; }
      .tripId { font-size: 12px; font-weight: 700; }
      .tripAmt { font-size: 12px; font-weight: 800; }
      .tripMeta { margin-top: 6px; font-size: 11px; color: #64748b; }
      .tripRoute { margin-top: 6px; font-size: 12px; color: #0f172a; word-break: break-word; overflow-wrap: anywhere; }
      .footer { margin-top: 14px; font-size: 11px; color: #94a3b8; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="hero">
        <div class="eyebrow">Pending trip claims</div>
        <div class="title">Claim summary</div>
        ${driverLine ? `<p class="sub">${safe(driverLine)}</p>` : ``}
        <p class="sub">Generated at ${safe(p.generatedAt)}</p>
      </div>
      ${groupsHtml}
      <div class="footer">Generated from Pulse Driver · ${safe(p.generatedAt)}</div>
    </div>
  </body>
</html>`;
}

const LEDGER_TYPE_LABELS: Record<string, string> = {
  salary: 'Monthly salary',
  settlement: 'Trip-based',
  advance: 'Advance',
  reimbursement: 'Reimbursement',
  adjustment: 'Adjustment',
  deduction: 'Deduction',
};

function ledgerTypeLabel(type: string): string {
  return LEDGER_TYPE_LABELS[type] ?? type;
}

function PassbookHeroContours() {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 340 280"
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Path
        d="M-20 78 C 40 36, 92 118, 152 74 S 248 18, 364 86"
        stroke={Theme.cardWhite}
        strokeOpacity={0.18}
        strokeWidth={1.25}
        fill="none"
      />
      <Path
        d="M-20 108 C 52 68, 104 148, 164 104 S 262 48, 364 116"
        stroke={Theme.cardWhite}
        strokeOpacity={0.1}
        strokeWidth={1}
        fill="none"
      />
      <Path
        d="M188 -8 C 156 42, 228 64, 206 118 S 164 186, 246 248"
        stroke={Theme.cardWhite}
        strokeOpacity={0.14}
        strokeWidth={1.1}
        fill="none"
      />
    </Svg>
  );
}

const AMBER_50 = 'rgba(245,158,11,0.12)';

/** Room so the last trip card can scroll clear of the floating driver tab bar. */
function driverTabBarScrollInset(bottomInset: number): number {
  const footerPadTop = 6;
  const dockHeight = Layout.tabBarHeight + 5;
  const footerPadBottom = Math.max(Math.round(bottomInset * 0.35), 10);
  return footerPadTop + dockHeight + footerPadBottom + 28;
}

export default function DriverPassbookDetailScreen() {
  usePreventScreenCapture();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useDriverTheme();
  const colors = useDriverThemeColors();
  const isDark = theme === 'dark';
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ orgId: string; orgName?: string; from?: string }>();
  const orgId = typeof params.orgId === 'string' ? params.orgId : params.orgId?.[0] ?? '';
  const orgName = (typeof params.orgName === 'string' ? params.orgName : params.orgName?.[0]) ?? 'Fleet';
  const orgBrandingById = useOrgBrandingByIds([orgId]);
  const from = typeof params.from === 'string' ? params.from : params.from?.[0] ?? 'dashboard';

  const handleBack = useCallback(() => {
    if (from === 'history') {
      router.navigate('/(driver)/passbook/history');
      return;
    }
    if (from === 'wallet') {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.navigate({ pathname: '/(driver)/wallet', params: { tab: 'fleet' } });
      }
      return;
    }
    if (from === 'requests') {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.navigate('/(driver)/requests');
      }
      return;
    }
    router.navigate('/(driver)');
  }, [router, from]);

  const openWhatsAppReminder = useCallback(async (message: string) => {
    const encoded = encodeURIComponent(message);
    const waWeb = `https://wa.me/?text=${encoded}`;
    const waNative = `whatsapp://send?text=${encoded}`;
    try {
      if (Platform.OS !== 'web') {
        const can = await Linking.canOpenURL(waNative);
        await Linking.openURL(can ? waNative : waWeb);
      } else {
        await Linking.openURL(waWeb);
      }
    } catch {
      // ignore
    }
  }, []);

  const promptWhatsAppReminder = useCallback(async (message: string) => {
    setWhatsAppReminderMessage(message);
  }, []);

  const shareCashReceiptPdf = useCallback(async (p: Parameters<typeof buildCashReceiptHtml>[0]) => {
    const html = buildCashReceiptHtml(p);
    const file = await Print.printToFileAsync({ html: injectPulseWatermarkIntoHtml(html) });
    if (Platform.OS === 'web') {
      window.open(file.uri, '_blank');
      return;
    }
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert('Share unavailable', 'Sharing is not available on this device.');
      return;
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share receipt',
      UTI: 'com.adobe.pdf',
    });
  }, []);

  const shareBulkClaimPdf = useCallback(
    async (p: Parameters<typeof buildBulkClaimHtml>[0]) => {
      const html = buildBulkClaimHtml(p);
      const file = await Print.printToFileAsync({ html: injectPulseWatermarkIntoHtml(html) });
      if (Platform.OS === 'web') {
        window.open(file.uri, '_blank');
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Share unavailable', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share claim PDF',
        UTI: 'com.adobe.pdf',
      });
    },
    [],
  );

  const derivePaymentMode = useCallback((raw?: string | null) => deriveDriverPaymentMode(raw), []);

  const [driver, setDriver] = useState<driversService.DriverRow | null>(null);
  const [invites, setInvites] = useState<driversService.DriverInviteRow[]>([]);
  const [trips, setTrips] = useState<tripsService.TripRow[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<driversService.DriverLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [earningsMainTab, setEarningsMainTab] = useState<'trips' | 'cash'>('trips');
  const [journeySearch, setJourneySearch] = useState('');
  const [journeyFilter, setJourneyFilter] = useState<'all' | 'pending' | 'fleet_marked' | 'settled'>('all');
  const [claimAllLoading, setClaimAllLoading] = useState(false);
  const [ledgerReceiptPreview, setLedgerReceiptPreview] = useState<DriverLedgerReceiptPreview | null>(null);
  const [whatsAppReminderMessage, setWhatsAppReminderMessage] = useState<string | null>(null);
  const [markPaidLoadingTripId, setMarkPaidLoadingTripId] = useState<string | null>(null);

  const inviteBranding = useMemo(() => {
    const inv = invites.find(
      (i) => String(i.from_organization_id ?? '').trim() === String(orgId).trim(),
    );
    return inv
      ? {
          logoUrl: inv.from_org_logo_url,
          avatarSeed: inv.from_org_avatar_seed,
          avatarUrl: inv.from_org_avatar_url,
        }
      : null;
  }, [invites, orgId]);
  const fleetOrgAvatarUri = useMemo(
    () =>
      resolveDriverOrgAvatarUri({
        orgId,
        orgName,
        branding: orgBrandingById[orgId],
        logoUrl: inviteBranding?.logoUrl,
        avatarSeed: inviteBranding?.avatarSeed,
        avatarUrl: inviteBranding?.avatarUrl,
      }),
    [orgId, orgName, orgBrandingById, inviteBranding],
  );

  const [markPaidConfirmState, setMarkPaidConfirmState] = useState<{
    trip: tripsService.TripRow;
    amount: number;
    sourceLedger?: driversService.DriverLedgerRow | null;
  } | null>(null);
  const [settledSuccessState, setSettledSuccessState] = useState<{
    tripDisplay: string;
    amount: number;
  } | null>(null);

  const load = useCallback(() => {
    if (!profile?.uid || !orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    driversService.getLinkedDriversForCurrentUser(profile.uid).then((res) => {
      const drivers = res.drivers ?? [];
      const d = drivers.find((x) => x.organization_id === orgId);
      setDriver(d ?? null);
      if (!d) {
        setInvites([]);
        setTrips([]);
        setLedgerEntries([]);
        setLoading(false);
        return;
      }
      Promise.all([
        tripsService.getTripsByDriver(d.id),
        driversService.getDriverLedgerByDriver(d.id),
        driversService.getDriverInvitesReceived(),
      ])
        .then(([tRes, ledgerRes, invitesRes]) => {
          setTrips(tRes.trips ?? []);
          setLedgerEntries(ledgerRes.entries ?? []);
          setInvites(invitesRes.invites ?? []);
        })
        .catch(() => {
          setInvites([]);
          setTrips([]);
          setLedgerEntries([]);
        })
        .finally(() => {
          setLoading(false);
        });
    });
  }, [profile?.uid, orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const tripsForOrg = useMemo(
    () => trips.filter((t) => String(t.organization_id ?? '') === String(orgId)),
    [trips, orgId],
  );

  const completedTrips = useMemo(() => {
    const list = tripsForOrg.filter((t) => tripsService.isTripCompleted(t));
    return [...list].sort((a, b) => {
      const da = new Date(a.completed_at ?? a.updated_at ?? a.created_at).getTime();
      const db = new Date(b.completed_at ?? b.updated_at ?? b.created_at).getTime();
      return db - da;
    });
  }, [tripsForOrg]);
  const driverTripNumberById = useMemo(
    () => buildDriverTripNumberMap(tripsForOrg),
    [tripsForOrg],
  );

  const hasFleetPaidPendingToken = useCallback((raw?: string | null) => {
    const s = (raw ?? '').trim();
    if (!s) return false;
    return /Sync\s*:\s*FLEET_PAID_PENDING/i.test(s);
  }, []);

  const isLegacyFleetPendingEvidence = useCallback((raw?: string | null) => {
    const s = (raw ?? '').trim();
    if (!s) return false;
    return /(\bUTR\b|\bMode\s*:|\bTrip\s*Commission\b|\bTrip\s*Payment\b|\bSettlement\b)/i.test(s);
  }, []);

  const { receivedByTripId, nonTripLedgerEntries, latestCreditLedgerByTripId } = useMemo(() => {
    const byTrip: Record<string, number> = {};
    const nonTrip: driversService.DriverLedgerRow[] = [];
    const latestByTrip: Record<string, driversService.DriverLedgerRow> = {};
    for (const e of ledgerEntries) {
      const amt = Number(e.amount) || 0;
      const tid = e.trip_id?.trim() || null;
      if (tid) {
        // Only settlement credits (verified by driver) count as "received".
        if (e.type === 'settlement') byTrip[tid] = (byTrip[tid] ?? 0) + amt;
      } else {
        nonTrip.push(e);
      }

      // Only settlement credits (amt > 0) are used to infer payment mode.
      if (tid && e.type === 'settlement' && amt > 0) {
        const prev = latestByTrip[tid];
        const prevT = prev?.created_at ? new Date(prev.created_at).getTime() : 0;
        const nextT = e.created_at ? new Date(e.created_at).getTime() : 0;
        if (!prev || nextT > prevT) latestByTrip[tid] = e;
      }
    }
    return { receivedByTripId: byTrip, nonTripLedgerEntries: nonTrip, latestCreditLedgerByTripId: latestByTrip };
  }, [ledgerEntries]);

  const latestFleetPaidPendingLedgerByTripId = useMemo(() => {
    const byTrip: Record<string, driversService.DriverLedgerRow> = {};
    for (const e of ledgerEntries) {
      const tid = e.trip_id?.trim() || null;
      if (!tid) continue;
      if ((receivedByTripId[tid] ?? 0) > 0) continue;
      if (e.type === 'settlement') continue;
      const amt = Number(e.amount) || 0;
      if (amt <= 0) continue;
      if (!hasFleetPaidPendingToken(e.description) && !isLegacyFleetPendingEvidence(e.description)) continue;
      const prev = byTrip[tid];
      const prevT = prev?.created_at ? new Date(prev.created_at).getTime() : 0;
      const nextT = e.created_at ? new Date(e.created_at).getTime() : 0;
      if (!prev || nextT > prevT) byTrip[tid] = e;
    }
    return byTrip;
  }, [ledgerEntries, receivedByTripId, hasFleetPaidPendingToken, isLegacyFleetPendingEvidence]);

  const totalReceived = Math.round(
    ledgerEntries.reduce((sum, e) => {
      const tid = e.trip_id?.trim() || null;
      const amt = Number(e.amount) || 0;
      if (tid) return e.type === 'settlement' ? sum + amt : sum;
      return sum + amt;
    }, 0),
  );

  const acceptedInviteForOrg = useMemo(() => {
    return invites
      .filter(
        (inv) =>
          String(inv.from_organization_id ?? '') === String(orgId) &&
          String(inv.status ?? '').toLowerCase() === 'accepted',
      )
      .sort(
        (a, b) =>
          new Date(b.responded_at ?? b.created_at).getTime() -
          new Date(a.responded_at ?? a.created_at).getTime(),
      )[0] ?? null;
  }, [invites, orgId]);

  const salaryTermLines = useMemo(() => {
    if (acceptedInviteForOrg) return buildDriverInviteSalaryLines(acceptedInviteForOrg);
    return buildCompensationSalaryLines({
      payableAmount: driver?.payable_amount ?? null,
      commissionPercent: driver?.commission_percent ?? null,
      commissionPerKm: driver?.commission_per_km ?? null,
    });
  }, [acceptedInviteForOrg, driver?.payable_amount, driver?.commission_percent, driver?.commission_per_km]);

  const tripPayoutTerms = useMemo(
    () => ({
      commissionPercent: acceptedInviteForOrg?.commission_percent ?? driver?.commission_percent ?? null,
      commissionPerKm: acceptedInviteForOrg?.commission_per_km ?? driver?.commission_per_km ?? null,
      payableAmount: acceptedInviteForOrg?.payable_amount ?? driver?.payable_amount ?? null,
    }),
    [
      acceptedInviteForOrg?.commission_percent,
      acceptedInviteForOrg?.commission_per_km,
      acceptedInviteForOrg?.payable_amount,
      driver?.commission_percent,
      driver?.commission_per_km,
      driver?.payable_amount,
    ],
  );

  const earningsForTrip = useCallback(
    (trip: tripsService.TripRow) => tripEarningsForDriver(trip, tripPayoutTerms),
    [tripPayoutTerms],
  );

  /** True only when this specific trip has real agreed payout terms — never inferred from an aggregate/estimated guess. */
  const hasAgreedPayoutTermsForTrip = useCallback(
    (trip: tripsService.TripRow) =>
      resolveDriverTripPayoutTerms(trip, tripPayoutTerms).hasAgreedPayoutTerms,
    [tripPayoutTerms],
  );

  /** Same as earningsForTrip(), but ₹0 for any trip with no agreed payout terms. */
  const gatedEarningsForTrip = useCallback(
    (trip: tripsService.TripRow) =>
      hasAgreedPayoutTermsForTrip(trip) ? earningsForTrip(trip) : 0,
    [hasAgreedPayoutTermsForTrip, earningsForTrip],
  );

  /**
   * No agreed pay terms on record, yet trips are being valued anyway via the
   * legacy 10% guess. Surfacing this is the point: an unlabelled estimate reads
   * as money owed, and nobody agreed to it.
   */
  const hasAgreedPayTerms =
    (tripPayoutTerms.commissionPercent != null &&
      Number(tripPayoutTerms.commissionPercent) > 0) ||
    (tripPayoutTerms.commissionPerKm != null &&
      Number(tripPayoutTerms.commissionPerKm) > 0);

  const estimatedTripCount = useMemo(
    () =>
      completedTrips.filter(
        (trip) =>
          tripEarningsDetailForDriver(trip, tripPayoutTerms).isEstimated,
      ).length,
    [completedTrips, tripPayoutTerms],
  );

  const showPayTermsPrompt = !hasAgreedPayTerms && estimatedTripCount > 0;

  const totalEarned = useMemo(() => {
    return Math.round(completedTrips.reduce((sum, trip) => sum + gatedEarningsForTrip(trip), 0));
  }, [completedTrips, gatedEarningsForTrip]);

  const pendingToCollect = useMemo(() => Math.max(0, totalEarned - totalReceived), [totalEarned, totalReceived]);

  const joinedLabel = useMemo(() => {
    const raw = driver?.created_at ?? null;
    if (!raw) return null;
    return new Date(raw).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }, [driver?.created_at]);

  const activeLabel = useMemo(() => {
    const raw = driver?.created_at ?? null;
    if (!raw) return null;
    const start = new Date(raw).getTime();
    const now = Date.now();
    const days = Math.max(0, Math.round((now - start) / (1000 * 60 * 60 * 24)));
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    if (years <= 0 && months <= 0) return 'ACTIVE';
    if (years <= 0) return `${months}M ACTIVE`;
    return `${years}Y ${months}M ACTIVE`;
  }, [driver?.created_at]);

  const receivedTrips = useMemo(
    () => completedTrips.filter((t) => (receivedByTripId[t.id] ?? 0) > 0),
    [completedTrips, receivedByTripId],
  );

  const tripJourneyItems = useMemo(() => {
    return completedTrips.map((trip) => {
      const receivedAmt = receivedByTripId[trip.id] ?? 0;
      const isSettled = receivedAmt > 0;
      const fleetPendingLedger = latestFleetPaidPendingLedgerByTripId[trip.id];
      const hasFleetPending = !!fleetPendingLedger;
      const isActionRequired = !isSettled && !hasFleetPending && isAggregateTrip(trip) && gatedEarningsForTrip(trip) === 0;
      const status: 'Pending' | 'Action Required' | 'Settled' = isSettled
        ? 'Settled'
        : isActionRequired
          ? 'Action Required'
          : 'Pending';
      const latestLedger = latestCreditLedgerByTripId[trip.id];
      const latestDesc = latestLedger?.description ?? null;
      const hasReceiptMeta = !!latestDesc && /(\bUTR\b|\bMode\s*:)/i.test(String(latestDesc));
      const paymentMode = derivePaymentMode(latestDesc);
      const paidLabel = hasReceiptMeta
        ? 'Paid synced'
        : paymentMode === 'UPI'
          ? 'Paid via UPI'
          : paymentMode === 'BANK TRANSFER'
            ? 'Paid to bank'
            : paymentMode === 'CASH'
              ? 'Paid in cash'
              : 'Paid to bank';

      const fleetPendingDesc = fleetPendingLedger?.description ?? null;
      const fleetPendingMode = derivePaymentMode(fleetPendingDesc);
      const fleetPendingLabel =
        fleetPendingMode === 'UPI'
          ? 'Fleet marked paid (UPI)'
          : fleetPendingMode === 'BANK TRANSFER'
            ? 'Fleet marked paid (Bank)'
            : fleetPendingMode === 'CASH'
              ? 'Fleet marked paid (Cash)'
              : 'Fleet marked paid';

      const subStatus = isSettled
        ? paidLabel
        : isActionRequired
          ? 'Ready to claim'
          : hasFleetPending
            ? fleetPendingLabel
            : 'Pending from fleet';

      return {
        trip,
        id: getDriverTripDisplayNumber(trip, driverTripNumberById),
        rawDate: trip.completed_at ?? trip.updated_at ?? trip.created_at ?? '',
        date: formatTransactionDateSection(trip.completed_at ?? trip.updated_at ?? trip.created_at ?? ''),
        amount: Math.round(
          isSettled
            ? receivedAmt
            : hasFleetPending
              ? Number(fleetPendingLedger?.amount ?? gatedEarningsForTrip(trip))
              : gatedEarningsForTrip(trip),
        ),
        status,
        subStatus,
        provider: orgName,
        from: trip.pickup_area?.trim() || 'Unknown origin',
        to: trip.drop_location?.trim() || 'Unknown destination',
        time: new Date(trip.completed_at ?? trip.updated_at ?? trip.created_at ?? '').toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }),
        fleetPendingLedger: isSettled ? null : (fleetPendingLedger ?? null),
      };
    });
  }, [
    completedTrips,
    receivedByTripId,
    latestCreditLedgerByTripId,
    derivePaymentMode,
    latestFleetPaidPendingLedgerByTripId,
    orgName,
    driverTripNumberById,
    gatedEarningsForTrip,
  ]);

  const isFleetMarkedAwaitingVerify = useCallback(
    (item: (typeof tripJourneyItems)[number]) =>
      item.status !== 'Settled' && !!item.fleetPendingLedger,
    [],
  );

  const filteredTripJourneyItems = useMemo(() => {
    const search = journeySearch.trim().toLowerCase();
    return tripJourneyItems.filter((item) => {
      const matchesSearch =
        search.length === 0 ||
        item.id.toLowerCase().includes(search) ||
        item.from.toLowerCase().includes(search) ||
        item.to.toLowerCase().includes(search) ||
        item.provider.toLowerCase().includes(search);

      const fleetMarked = isFleetMarkedAwaitingVerify(item);
      const matchesFilter =
        journeyFilter === 'all' ||
        (journeyFilter === 'settled' && item.status === 'Settled') ||
        (journeyFilter === 'fleet_marked' && fleetMarked) ||
        (journeyFilter === 'pending' &&
          item.status !== 'Settled' &&
          !fleetMarked &&
          (item.status === 'Pending' || item.status === 'Action Required'));

      return matchesSearch && matchesFilter;
    });
  }, [tripJourneyItems, journeySearch, journeyFilter, isFleetMarkedAwaitingVerify]);

  const pendingTripJourneyItems = useMemo(() => {
    return filteredTripJourneyItems.filter(
      (i) => i.status === 'Action Required' || (i.status === 'Pending' && !i.fleetPendingLedger),
    );
  }, [filteredTripJourneyItems]);

  const filteredTripJourneySections = useMemo(() => {
    const map = new Map<string, typeof filteredTripJourneyItems>();
    filteredTripJourneyItems.forEach((item) => {
      const bucket = map.get(item.date) ?? [];
      bucket.push(item);
      map.set(item.date, bucket);
    });
    return Array.from(map.entries()).map(([sectionLabel, items]) => ({ sectionLabel, items }));
  }, [filteredTripJourneyItems]);

  const filteredCashTrips = useMemo(() => {
    const search = journeySearch.trim().toLowerCase();
    return receivedTrips.filter((trip) => {
      const haystack = [
        getDriverTripDisplayNumber(trip, driverTripNumberById),
        trip.pickup_area ?? '',
        trip.drop_location ?? '',
        orgName,
      ]
        .join(' ')
        .toLowerCase();
      return search.length === 0 || haystack.includes(search);
    });
  }, [receivedTrips, journeySearch, orgName, driverTripNumberById]);

  const filteredCashSections = useMemo(() => {
    const list = [...filteredCashTrips]
      .sort((a, b) => {
        const da = new Date(a.completed_at ?? a.updated_at ?? a.created_at).getTime();
        const db = new Date(b.completed_at ?? b.updated_at ?? b.created_at).getTime();
        return db - da;
      })
      .slice(0, 50);

    const bySection: { sectionLabel: string; trips: typeof list }[] = [];
    let current = '';
    let bucket: typeof list = [];
    for (const trip of list) {
      const label = formatTransactionDateSection(trip.completed_at ?? trip.updated_at ?? trip.created_at ?? '');
      if (label !== current) {
        if (bucket.length) bySection.push({ sectionLabel: current, trips: bucket });
        current = label;
        bucket = [trip];
      } else {
        bucket.push(trip);
      }
    }
    if (bucket.length) bySection.push({ sectionLabel: current, trips: bucket });
    return bySection;
  }, [filteredCashTrips]);

  const claimAllFleetPendingTrips = useCallback(async () => {
    if (claimAllLoading) return;
    if (pendingTripJourneyItems.length === 0) return;
    const fleetDriverId = driver?.id ?? '';
    if (!orgId || !fleetDriverId) return;

    // Independent write-path gate: re-check every trip here, regardless of
    // whether the displayed/claimable list upstream was correctly filtered.
    // A trip with no agreed payout terms must never be claimed.
    const gatedItems = pendingTripJourneyItems.filter((item) =>
      hasAgreedPayoutTermsForTrip(item.trip),
    );
    if (gatedItems.length === 0) {
      Alert.alert('Nothing to claim', 'None of these trips have agreed payout terms.');
      return;
    }

    setClaimAllLoading(true);
    try {
      const tripIds = gatedItems.map((i) => i.trip.id);
      const total = gatedItems.reduce((sum, i) => sum + Math.round(i.amount), 0);

      await salaryRequestsService.createSalaryRequest(fleetDriverId, orgId, 'trip_based', total, {
        createdBy: profile?.uid ?? null,
        tripIds,
        note: `Bulk claim (${tripIds.length} trips)`,
      });

      const generatedAt = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      const tripsPayload = gatedItems.map((item) => {
        const date = new Date(item.trip.completed_at ?? item.trip.updated_at ?? item.trip.created_at ?? '').toLocaleString(
          'en-IN',
          {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          },
        );
        return {
          displayId: item.id,
          amount: Math.round(item.amount),
          date,
          route: `${item.from} → ${item.to}`,
          status: item.subStatus || item.status,
        };
      });

      await shareBulkClaimPdf({
        driverName: driver?.name ?? null,
        driverPhone: driver?.phone ?? null,
        generatedAt,
        groups: [{ fleetName: orgName, total, trips: tripsPayload }],
      });

      const msg = buildBulkTripClaimWhatsappMessage({
        tripCount: gatedItems.length,
        totalAmount: total,
        driverName: driver?.name ?? null,
        driverPhone: driver?.phone ?? null,
      });
      await promptWhatsAppReminder(msg);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not claim pending trips.';
      if (Platform.OS === 'web') window.alert(message);
      else Alert.alert('Claim failed', message);
    } finally {
      setClaimAllLoading(false);
    }
  }, [
    claimAllLoading,
    pendingTripJourneyItems,
    hasAgreedPayoutTermsForTrip,
    driver?.id,
    driver?.name,
    driver?.phone,
    orgId,
    orgName,
    profile?.uid,
    shareBulkClaimPdf,
    promptWhatsAppReminder,
  ]);

  const markTripAsPaid = useCallback(
    async (
      trip: tripsService.TripRow,
      amount: number,
      sourceLedger?: driversService.DriverLedgerRow | null,
    ) => {
      const driverId = trip.driver_id ?? driver?.id ?? null;
      if (!driverId || !trip.organization_id) {
        Alert.alert('Error', 'Missing driver or organization.');
        return;
      }
      const rawDescription = sourceLedger?.description ?? `Trip ${getDriverTripDisplayNumber(trip, driverTripNumberById)}`;
      const settledDescription = rawDescription.replace(/\s*\|\s*Sync\s*:\s*FLEET_PAID_PENDING\s*/i, '').trim();

      setMarkPaidLoadingTripId(trip.id);
      let { error, row } = await driversService.createDriverLedgerEntry(
        trip.organization_id,
        driverId,
        Math.round(amount),
        'settlement',
        { tripId: trip.id, createdBy: profile?.uid ?? null, description: settledDescription },
      );
      if (error?.message?.includes("driver_ledger_created_by_fkey")) {
        const retry = await driversService.createDriverLedgerEntry(
          trip.organization_id,
          driverId,
          Math.round(amount),
          'settlement',
          { tripId: trip.id, createdBy: null, description: settledDescription },
        );
        error = retry.error;
        if (retry.row) row = retry.row;
      }
      setMarkPaidLoadingTripId(null);

      if (error) {
        const isDriverLedgerRls =
          /row-level security policy.*driver_ledger|driver_ledger.*row-level security/i.test(error.message);
        const message = isDriverLedgerRls
          ? "You don't have permission to record this payment yet. Ask support to apply the driver settlement policy."
          : error.message;
        if (Platform.OS === 'web') {
          window.alert(`Could not mark as paid: ${message}`);
        } else {
          Alert.alert('Could not mark as paid', message);
        }
        return;
      }
      if (row) {
        setLedgerEntries((prev) => [row, ...prev]);
      }
      load();
      const tripDisplay = getDriverTripDisplayNumber(trip, driverTripNumberById);
      const roundedAmount = Math.round(amount);
      if (sourceLedger) {
        setSettledSuccessState({ tripDisplay, amount: roundedAmount });
      } else if (Platform.OS === 'web') {
        window.alert(`${tripDisplay} · ₹${roundedAmount.toLocaleString('en-IN')} recorded as received.`);
      } else {
        Alert.alert(
          'Payment recorded',
          `${tripDisplay} · ₹${roundedAmount.toLocaleString('en-IN')} has been marked as received.`,
        );
      }
    },
    [driver?.id, profile?.uid, load, driverTripNumberById],
  );

  const confirmMarkAsPaid = useCallback(
    (trip: tripsService.TripRow, amount: number, sourceLedger?: driversService.DriverLedgerRow | null) => {
      setMarkPaidConfirmState({ trip, amount, sourceLedger: sourceLedger ?? null });
    },
    [],
  );

  if (loading) {
    return (
      <View style={[styles.loadingWrap, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <LoadingIndicator size="large" color={colors.emerald} />
        <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading passbook…</Text>
      </View>
    );
  }

  if (!driver) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingHorizontal: 24, paddingBottom: 20, borderColor: colors.border }]}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={12}>
            <FontAwesome name="arrow-left" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Passbook</Text>
        </View>
        <View style={styles.emptyCard}>
          <FontAwesome name="building-o" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No connection to this fleet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            You are not linked to this organization. Passbook is available only for your current connections.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
    <View style={[styles.container, { backgroundColor: colors.background }]}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingTop: insets.top + 56,
        paddingBottom: driverTabBarScrollInset(insets.bottom),
      }}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={
          isDark
            ? [Theme.driverEmeraldDark, Theme.driverCtaFill]
            : [Theme.driverCtaFill, Theme.driverEmeraldDark]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fleetHero}
      >
        <PassbookHeroContours />
        <View style={styles.fleetHeroTop}>
          <View style={styles.fleetHeroTitleWrap}>
            <Text style={styles.fleetHeroTitle} numberOfLines={1}>{orgName}</Text>
            <View style={styles.fleetHeroMetaRow}>
              <FontAwesome name="calendar-o" size={12} color={Theme.textOnPrimary} />
              <Text style={styles.fleetHeroMetaText} numberOfLines={1}>
                {joinedLabel ? `Joined ${joinedLabel}` : 'Joined'}
              </Text>
              <Text style={styles.fleetHeroMetaDot}>•</Text>
              <View style={styles.fleetHeroActivePill}>
                <View style={styles.fleetHeroActiveDot} />
                <Text style={styles.fleetHeroActiveText}>{activeLabel ?? 'ACTIVE'}</Text>
              </View>
            </View>
            {salaryTermLines.length > 0 ? (
              <View style={styles.fleetHeroPayTermsWrap}>
                {salaryTermLines.map((line) => (
                  <View key={line.label} style={styles.fleetHeroPayTermPill}>
                    <Text style={styles.fleetHeroPayTermLabel}>{line.label}</Text>
                    <Text style={styles.fleetHeroPayTermValue}>{line.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <View style={styles.fleetHeroIcon}>
            <Image
              source={{ uri: fleetOrgAvatarUri }}
              style={styles.fleetHeroIconImage}
              resizeMode="cover"
            />
          </View>
        </View>

        <View style={[styles.fleetHeroStatsCard, { backgroundColor: isDark ? colors.surface : Theme.cardWhite }]}>
          <Text style={[styles.fleetHeroPendingLabel, { color: isDark ? colors.textMuted : Theme.textSecondary }]}>
            Pending to collect
          </Text>
          <View style={styles.fleetHeroPendingRow}>
            <Text style={[styles.fleetHeroPendingAmount, { color: isDark ? colors.text : Theme.textPrimary }]}>
              ₹{pendingToCollect.toLocaleString('en-IN')}
            </Text>
            <View style={styles.fleetHeroBoltBadge}>
              <FontAwesome name="bolt" size={14} color={Theme.driverEmerald} />
            </View>
          </View>
          <View style={[styles.fleetHeroStatsHairline, { backgroundColor: isDark ? colors.border : Theme.borderMedium }]} />
          <View style={styles.fleetHeroStatsRow}>
            <View style={styles.fleetHeroStat}>
              <Text style={[styles.fleetHeroStatLabel, { color: isDark ? colors.textMuted : Theme.textSecondary }]}>
                Life earnings
              </Text>
              <Text style={[styles.fleetHeroStatValue, { color: isDark ? colors.text : Theme.textPrimary }]}>
                ₹{totalEarned.toLocaleString('en-IN')}
              </Text>
            </View>
            <View style={[styles.fleetHeroStatDivider, { backgroundColor: isDark ? colors.border : Theme.borderMedium }]} />
            <View style={styles.fleetHeroStat}>
              <Text style={[styles.fleetHeroStatLabel, { color: isDark ? colors.textMuted : Theme.textSecondary }]}>
                Settled funds
              </Text>
              <Text style={[styles.fleetHeroStatValue, { color: Theme.driverEmerald }]}>
                ₹{totalReceived.toLocaleString('en-IN')}
              </Text>
            </View>
          </View>
        </View>

        {showPayTermsPrompt ? (
          <View
            style={[
              styles.payTermsPrompt,
              {
                backgroundColor: isDark ? colors.surface : Theme.cardWhite,
                borderColor: isDark ? colors.border : Theme.borderMedium,
              },
            ]}
          >
            <FontAwesome name="exclamation-triangle" size={13} color={Theme.warning} />
            <View style={styles.payTermsPromptText}>
              <Text style={[styles.payTermsPromptTitle, { color: Theme.warning }]}>Estimated — no pay terms agreed</Text>
              <Text style={[styles.payTermsPromptBody, { color: isDark ? colors.textMuted : Theme.textSecondary }]}>
                {estimatedTripCount === 1 ? '1 trip is' : `${estimatedTripCount} trips are`} valued at a
                default 10% of trip value because no salary, commission % or per-km rate is set for this
                driver. Set pay terms to record what they are actually owed.
              </Text>
            </View>
          </View>
        ) : null}
      </LinearGradient>

      <View
        style={[
          styles.mainTabsWrap,
          {
            backgroundColor: isDark ? colors.surfaceElevated : Theme.cardWhite,
            borderColor: isDark ? colors.border : Theme.borderMedium,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.mainTab,
            earningsMainTab === 'trips' && [
              styles.mainTabActive,
              { backgroundColor: Theme.driverCtaFill },
            ],
          ]}
          onPress={() => setEarningsMainTab('trips')}
          activeOpacity={0.8}
        >
          <FontAwesome
            name="history"
            size={12}
            color={earningsMainTab === 'trips' ? Theme.textOnPrimary : colors.textMuted}
          />
          <Text
            style={[
              styles.mainTabText,
              earningsMainTab === 'trips' ? { color: Theme.textOnPrimary } : { color: colors.textMuted },
            ]}
          >
            Trips
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.mainTab,
            earningsMainTab === 'cash' && [
              styles.mainTabActive,
              { backgroundColor: Theme.driverCtaFill },
            ],
          ]}
          onPress={() => setEarningsMainTab('cash')}
          activeOpacity={0.8}
        >
          <FontAwesome
            name="arrow-down"
            size={12}
            color={earningsMainTab === 'cash' ? Theme.textOnPrimary : colors.textMuted}
          />
          <Text
            style={[
              styles.mainTabText,
              earningsMainTab === 'cash' ? { color: Theme.textOnPrimary } : { color: colors.textMuted },
            ]}
          >
            Transactions
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchSection}>
        <SearchBar
          value={journeySearch}
          onChangeText={setJourneySearch}
          placeholder={earningsMainTab === 'trips' ? 'Search trips...' : 'Search cash in...'}
          style={[
            styles.searchBar,
            {
              backgroundColor: isDark ? colors.surface : Theme.cardWhite,
              borderColor: isDark ? colors.border : Theme.borderMedium,
            },
          ]}
        />

        {earningsMainTab === 'trips' && (
          <View style={styles.filterChipScrollWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
            {[
              { id: 'all', label: 'All' },
              { id: 'pending', label: 'Pending' },
              { id: 'fleet_marked', label: 'Fleet marked' },
              { id: 'settled', label: 'Settled' },
            ].map((chip) => {
              const active = journeyFilter === chip.id;
              return (
                <TouchableOpacity
                  key={chip.id}
                  onPress={() => setJourneyFilter(chip.id as 'all' | 'pending' | 'fleet_marked' | 'settled')}
                  style={[
                    styles.filterChip,
                    active
                      ? { backgroundColor: Theme.driverCtaFill, borderColor: Theme.driverCtaFill }
                      : { backgroundColor: colors.surface, borderColor: isDark ? colors.border : Theme.borderMedium },
                  ]}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.filterChipText, { color: active ? Theme.textOnPrimary : colors.textMuted }]}>
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            </ScrollView>
          </View>
        )}

        {earningsMainTab === 'trips' && journeyFilter === 'pending' && pendingTripJourneyItems.length > 0 && (
          <TouchableOpacity
            activeOpacity={0.88}
            style={[styles.bulkClaimButton, { backgroundColor: colors.emerald, shadowColor: isDark ? '#000' : 'rgba(16,185,129,0.35)' }]}
            onPress={() => claimAllFleetPendingTrips().catch(() => {})}
            disabled={claimAllLoading}
          >
            <FontAwesome name={claimAllLoading ? 'spinner' : 'whatsapp'} size={16} color={colors.textOnPrimary} />
            <Text style={styles.bulkClaimButtonText}>
              {claimAllLoading ? 'REQUESTING…' : `CLAIM ALL (${pendingTripJourneyItems.length})`}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {earningsMainTab === 'trips' ? (
        <View style={[styles.ledgerSection, { paddingHorizontal: Layout.screenPaddingHorizontal }]}>
          <Text style={[styles.transactionHistoryTitle, { color: colors.text }]}>Trips</Text>
          {filteredTripJourneySections.length === 0 ? (
            <View style={styles.ledgerEmpty}>
              <DriverListEmptyArt kind="trips" />
              <Text style={[styles.ledgerEmptyText, { color: colors.textMuted }]}>No trips found</Text>
            </View>
          ) : (
            <View style={styles.tripsPremiumWrapPassbook}>
              {filteredTripJourneySections.map(({ sectionLabel, items }) => (
                <View key={sectionLabel} style={styles.tripsPremiumSectionPassbook}>
                  <View style={styles.tripsSectionHeaderRowPassbook}>
                    <View
                      style={[
                        styles.earningsSectionDot,
                        {
                          borderColor: colors.background,
                          backgroundColor: colors.emerald,
                        },
                      ]}
                    />
                    <Text style={[styles.tripsPremiumSectionLabelPassbook, { color: colors.textMuted }]}>{sectionLabel}</Text>
                  </View>
                  <View style={styles.tripsTimelineListPassbook}>
                    {items.map((item, tripIdx) => {
                      const trip = item.trip;
                      const receivedAmt = receivedByTripId[trip.id] ?? 0;
                      const pendingSettlement = receivedAmt === 0;
                      const fleetPendingLedger = item.fleetPendingLedger;
                      const hasFleetPending = !!fleetPendingLedger && item.status !== 'Settled';
                      const tripRef = item.id;
                      const providerShort = item.provider.split("'")[0];
                      const fleetAvatarUri = fleetOrgAvatarUri;
                      const from = item.from;
                      const to = item.to;
                      const pendingMode = derivePaymentMode(fleetPendingLedger?.description) ?? 'BANK TRANSFER';
                      const pendingUtr = extractUtr(fleetPendingLedger?.description) ?? '—';
                      const isLastTrip = tripIdx === items.length - 1;
                      const headerAmount = item.amount;

                      const statusLine =
                        item.status === 'Settled'
                          ? item.subStatus.toUpperCase()
                          : hasFleetPending
                            ? 'FLEET MARKED PAID'
                            : item.status === 'Action Required'
                              ? 'READY TO CLAIM'
                              : 'PENDING FROM FLEET';

                      const isActionRequiredPassbook = item.status === 'Action Required';
                      const isSettledPassbook = item.status === 'Settled';

                      return (
                        <View
                          key={trip.id}
                          style={[
                            styles.passbookTripCard,
                            {
                              backgroundColor: colors.surface,
                              borderColor: isDark ? colors.border : Theme.borderMedium,
                            },
                            !isLastTrip && { marginBottom: 14 },
                          ]}
                        >
                          <View style={styles.passbookTripTop}>
                            <View
                              style={[
                                styles.passbookTripIcon,
                                {
                                  backgroundColor: isActionRequiredPassbook
                                    ? Theme.negativeMuted
                                    : Theme.driverEmeraldMuted,
                                  overflow: 'hidden',
                                },
                              ]}
                            >
                              {isActionRequiredPassbook ? (
                                <FontAwesome name="exclamation-circle" size={16} color={Theme.warning} />
                              ) : hasFleetPending || isSettledPassbook ? (
                                <FontAwesome
                                  name="check"
                                  size={14}
                                  color={Theme.driverCtaFill}
                                />
                              ) : (
                                <Image
                                  source={{ uri: fleetAvatarUri }}
                                  style={styles.passbookTripIconImage}
                                  resizeMode="cover"
                                />
                              )}
                            </View>
                            <View style={styles.passbookTripHead}>
                              <Text
                                style={[styles.passbookTripId, { color: colors.text }]}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.72}
                              >
                                {tripRef}
                              </Text>
                              <Text style={[styles.passbookTripMeta, { color: colors.textMuted }]}>
                                {item.time} • {providerShort}
                              </Text>
                              <Text style={[styles.passbookTripSubStatus, { color: colors.textMuted }]} numberOfLines={2}>
                                {item.subStatus}
                              </Text>
                            </View>
                            <View style={styles.passbookTripRight}>
                              <Text style={[styles.passbookTripAmount, { color: colors.text }]}>
                                ₹{headerAmount.toLocaleString('en-IN')}
                              </Text>
                              <Text
                                style={[
                                  styles.passbookTripStatusPill,
                                  {
                                    backgroundColor: Theme.driverEmeraldMuted,
                                    color: Theme.driverEmerald,
                                    borderColor: Theme.driverEmeraldBorderSoft,
                                  },
                                ]}
                              >
                                {statusLine}
                              </Text>
                            </View>
                          </View>

                          <View
                            style={[
                              styles.passbookRouteCard,
                              {
                              backgroundColor: isDark ? colors.surfaceElevated : Theme.driverEmeraldWash,
                              borderColor: isDark ? colors.border : Theme.borderMedium,
                              },
                            ]}
                          >
                            <View style={styles.passbookRouteSide}>
                              <Text style={[styles.passbookRouteLabel, { color: colors.textMuted }]}>Origin</Text>
                              <Text style={[styles.passbookRouteValue, { color: colors.text }]} numberOfLines={1}>
                                {from}
                              </Text>
                            </View>
                            <View style={styles.passbookRouteMiddle}>
                              <View style={[styles.passbookRouteDot, { backgroundColor: Theme.driverEmerald }]} />
                              <View style={[styles.passbookRouteLine, { backgroundColor: Theme.driverEmeraldBorderSoft }]} />
                              <View style={[styles.passbookRouteDot, { backgroundColor: Theme.tripsMint }]} />
                            </View>
                            <View style={[styles.passbookRouteSide, styles.passbookRouteSideRight]}>
                              <Text style={[styles.passbookRouteLabel, { color: colors.textMuted }]}>Destination</Text>
                              <Text style={[styles.passbookRouteValue, { color: colors.text }]} numberOfLines={1}>
                                {to}
                              </Text>
                            </View>
                          </View>
                          {pendingSettlement && !hasFleetPending ? (
                            <View style={styles.tripActionWrap}>
                              <View style={styles.tripActionFull}>
                                <DriverCapturePaymentButton
                                  tripId={trip.id}
                                  due={Math.round(headerAmount)}
                                  lane="fleet"
                                  partyName={item.provider}
                                  label="Capture commission"
                                  block
                                />
                              </View>
                            </View>
                          ) : null}
                          {pendingSettlement && hasFleetPending ? (
                            <View style={styles.tripActionWrap}>
                              <View
                                style={[
                                  styles.tripActionHint,
                                  {
                                    backgroundColor: Theme.driverEmeraldMuted,
                                    borderColor: Theme.driverEmeraldBorderSoft,
                                  },
                                ]}
                              >
                                <Text style={[styles.tripActionHintText, { color: Theme.driverEmerald }]}>
                                  Fleet update: {pendingMode} · UTR {pendingUtr}
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={[styles.tripVerifyBtn, { backgroundColor: Theme.driverCtaFill }]}
                                onPress={() => confirmMarkAsPaid(trip, Math.round(headerAmount), fleetPendingLedger)}
                                disabled={markPaidLoadingTripId === trip.id}
                                activeOpacity={0.9}
                              >
                                {markPaidLoadingTripId === trip.id ? (
                                  <LoadingIndicator size="small" color={Theme.textOnPrimary} />
                                ) : (
                                  <>
                                    <FontAwesome name="check-circle" size={13} color={Theme.textOnPrimary} />
                                    <Text style={styles.tripVerifyBtnText}>Verify & update payment</Text>
                                  </>
                                )}
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={[styles.ledgerSection, { paddingHorizontal: Layout.screenPaddingHorizontal }]}>
          <Text style={[styles.transactionHistoryTitle, { color: colors.text }]}>Transactions</Text>
          {filteredCashSections.length === 0 ? (
            <View style={styles.ledgerEmpty}>
              <DriverListEmptyArt kind="money" />
              <Text style={[styles.ledgerEmptyText, { color: colors.textMuted }]}>No cash in yet</Text>
            </View>
          ) : (
            <View style={styles.cashPremiumWrap}>
              {filteredCashSections.map(({ sectionLabel, trips }) => (
                <View key={sectionLabel} style={styles.cashPremiumSection}>
                  <Text style={[styles.cashPremiumSectionLabel, { color: colors.textMuted }]}>{sectionLabel}</Text>
                  <View
                    style={[
                      styles.cashPremiumGroup,
                      {
                        backgroundColor: colors.surface,
                        borderColor: isDark ? colors.border : Theme.borderMedium,
                      },
                    ]}
                  >
                    {trips.map((trip, idx) => {
                      const routeSummary = [trip.pickup_area?.trim(), trip.drop_location?.trim()].filter(Boolean).join(' → ');
                      const tripRef = getDriverTripDisplayNumber(trip, driverTripNumberById);
                      const receivedAmt = receivedByTripId[trip.id] ?? 0;
                      const listDivider = isDark ? colors.borderSubtle : Theme.borderMedium;
                      const isLastTrip = idx === trips.length - 1;
                      const fleetName = orgName;
                      const fleetAvatarUri = fleetOrgAvatarUri;
                      const ledger = latestCreditLedgerByTripId[trip.id];
                      const paymentMode = derivePaymentMode(ledger?.description) ?? '—';
                      const utr = extractUtr(ledger?.description) ?? '—';
                      const capturedAt = phonePeMetaDate(ledger?.created_at ?? trip.completed_at ?? trip.updated_at ?? trip.created_at);
                      const txnId = ledger?.id ?? tripRef;
                      return (
                        <View
                          key={trip.id}
                          style={[
                            styles.cashPremiumRow,
                            !isLastTrip && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: listDivider },
                          ]}
                        >
                          <TouchableOpacity
                            style={styles.cashPremiumRowTouch}
                            activeOpacity={0.8}
                            onPress={() =>
                              setLedgerReceiptPreview({
                                statusLabel: "Payment received",
                                title: "Transaction",
                                amount: receivedAmt,
                                isIn: true,
                                partyAvatar: {
                                  name: fleetName,
                                  entityType: "supplier",
                                  organizationImageUrl:
                                    orgBrandingById[orgId]?.logoUrl ??
                                    orgBrandingById[orgId]?.avatarUrl ??
                                    null,
                                  organizationAvatarSeed:
                                    orgBrandingById[orgId]?.avatarSeed ?? null,
                                  initialsColorSeed: orgId,
                                },
                                details: buildDriverLedgerReceiptDetails({
                                  paymentDateRaw:
                                    ledger?.created_at ??
                                    trip.completed_at ??
                                    trip.updated_at ??
                                    trip.created_at,
                                  partyName: fleetName,
                                  tripDisplay: tripRef,
                                  paymentMode,
                                  reference: utr && utr !== "—" ? utr : "—",
                                  route: routeSummary,
                                }),
                                secondaryAction: {
                                  label: "Share",
                                  onPress: () => {
                                    const msg = buildSettlementShareMessage({
                                      fleetName,
                                      tripId: tripRef,
                                      amount: receivedAmt,
                                      transactionId: String(txnId),
                                      utr: String(utr),
                                    });
                                    Share.share({ message: msg }).catch(() => {});
                                  },
                                },
                                tripAction: {
                                  label: "View trip",
                                  onPress: () => {
                                    setLedgerReceiptPreview(null);
                                    router.push(`/driver-trip/${trip.id}` as never);
                                  },
                                },
                                primaryAction: {
                                  label: "PDF receipt",
                                  onPress: () => {
                                    void shareCashReceiptPdf({
                                      title: "SETTLEMENT RECEIVED",
                                      amount: receivedAmt,
                                      transactionId: String(txnId ?? "—"),
                                      utr: String(utr ?? "—"),
                                      paymentMode: String(paymentMode ?? "—"),
                                      capturedAt: String(capturedAt ?? "—"),
                                      reference: String(tripRef ?? "—"),
                                      settledTo: String(fleetName ?? "—"),
                                      route: routeSummary || null,
                                    }).catch((e) => {
                                      const message =
                                        e instanceof Error ? e.message : "Could not generate receipt.";
                                      if (Platform.OS === "web") window.alert(message);
                                      else Alert.alert("Receipt failed", message);
                                    });
                                  },
                                },
                              })
                            }
                          >
                            <View style={styles.cashPremiumLeft}>
                              <View
                                style={[
                                  styles.cashPremiumAvatar,
                                  { backgroundColor: isDark ? colors.surfaceElevated : 'rgba(248,250,252,0.92)' },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.cashPremiumAvatarImageClip,
                                    {
                                      borderColor: 'rgba(226,232,240,0.7)',
                                      backgroundColor: isDark ? colors.surfaceElevated : 'rgba(248,250,252,0.92)',
                                    },
                                  ]}
                                >
                                  <Image
                                    source={{ uri: fleetAvatarUri }}
                                    style={styles.cashPremiumAvatarImage}
                                    resizeMode="cover"
                                  />
                                </View>
                                <View style={[styles.cashPremiumAvatarBadge, { backgroundColor: colors.surface }]}>
                                  <FontAwesome name="arrow-down" size={10} color={colors.emerald} />
                                </View>
                              </View>
                              <View style={styles.cashPremiumBody}>
                                <Text style={[styles.cashPremiumSource, { color: colors.text }]} numberOfLines={1}>
                                  {fleetName}
                                </Text>
                                <Text style={[styles.cashPremiumMethod, { color: colors.textMuted }]} numberOfLines={1}>
                                  {tripRef} • {phonePeMetaDate(trip.completed_at ?? trip.updated_at ?? trip.created_at)}
                                </Text>
                              </View>
                            </View>

                            <View style={styles.cashPremiumRightWrap}>
                              <View style={styles.cashPremiumRight}>
                                <Text style={[styles.cashPremiumAmount, { color: colors.emerald }]}>
                                  +₹{receivedAmt.toLocaleString('en-IN')}
                                </Text>
                                <View style={styles.cashPremiumStatusRow}>
                                  <FontAwesome name="check-circle" size={8} color={colors.emerald} />
                                  <Text style={[styles.cashPremiumStatus, { color: colors.emerald }]}>SUCCESS</Text>
                                </View>
                              </View>
                              <FontAwesome
                                name="chevron-right"
                                size={10}
                                color={colors.textMuted}
                              />
                            </View>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {nonTripLedgerEntries.length > 0 && (
        <View style={[styles.section, styles.gpayListSection]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Salary & other payments</Text>
          <View
            style={[
              styles.salaryCard,
              {
                backgroundColor: colors.surface,
                borderColor: isDark ? colors.border : Theme.borderMedium,
              },
            ]}
          >
          {nonTripLedgerEntries.map((entry, entryIdx) => {
            const label = entry.description?.trim() || ledgerTypeLabel(entry.type);
            const raw = Number(entry.amount) || 0;
            const isCredit = raw >= 0;
            const amtAbs = Math.abs(raw);
            const amountLabel = isCredit
              ? `+ ₹${amtAbs.toLocaleString('en-IN')}`
              : `₹${amtAbs.toLocaleString('en-IN')}`;
            const amountColor = isCredit
              ? isDark
                ? colors.emerald
                : Theme.gpayAmountReceived
              : isDark
                ? colors.text
                : Theme.gpayListTitle;
            const primary = isCredit ? 'Payment received' : 'Adjustment';
            const metaRight = isCredit ? 'Added to cash balance' : 'Updated in passbook';
            const listDivider = isDark ? colors.borderSubtle : Theme.borderMedium;
            const subColor = colors.textMuted;
            const metaColor = colors.textMuted;
            const isLastEntry = entryIdx === nonTripLedgerEntries.length - 1;
            const statusLabel = isCredit ? 'RECEIVED' : 'PENDING';
            const statusPillBg = isCredit ? colors.emeraldMuted : AMBER_50;
            const statusPillTextColor = isCredit ? colors.emerald : Theme.warning;
            const statusPillBorderColor = isCredit ? colors.emeraldBorderSoft : 'rgba(180,83,9,0.25)';
            const iconSqBg = isCredit ? colors.emeraldMuted : AMBER_50;
            const iconColor = isCredit ? colors.emerald : Theme.warning;
            return (
              <View
                key={entry.id}
                style={[
                  styles.ppTxCard,
                  { paddingHorizontal: 0 },
                  !isLastEntry && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: listDivider },
                ]}
              >
                <View style={styles.ppTxTopRow}>
                  <View style={[styles.ppIconSq, { backgroundColor: iconSqBg }]}>
                    <FontAwesome
                      name={isCredit ? 'arrow-down' : 'arrow-up'}
                      size={18}
                      color={iconColor}
                    />
                  </View>
                  <View style={styles.ppMiddle}>
                    <View style={styles.ppPrimaryRow}>
                      <Text style={[styles.ppPrimary, { color: colors.text }]} numberOfLines={1}>
                        {primary}
                      </Text>
                      <View style={[styles.txStatusPill, { backgroundColor: statusPillBg, borderColor: statusPillBorderColor }]}>
                        <Text style={[styles.txStatusPillText, { color: statusPillTextColor }]}>{statusLabel}</Text>
                      </View>
                    </View>
                    <Text style={[styles.ppSecondary, { color: subColor }]} numberOfLines={2}>
                      {label}
                    </Text>
                  </View>
                  <Text style={[styles.ppAmount, { color: amountColor }]} numberOfLines={1}>
                    {amountLabel}
                  </Text>
                </View>
                <View style={styles.ppMetaRow}>
                  <Text style={[styles.ppMetaLeft, { color: metaColor }]}>{phonePeMetaDate(entry.created_at)}</Text>
                  <View style={styles.ppMetaRight}>
                    <Text style={[styles.ppMetaRightText, { color: metaColor }]} numberOfLines={1}>
                      {metaRight}
                    </Text>
                    <FontAwesome name="university" size={13} color={colors.emerald} style={styles.ppMetaBankIcon} />
                  </View>
                </View>
              </View>
            );
          })}
          </View>
        </View>
      )}

    </ScrollView>
    <TouchableOpacity
      onPress={handleBack}
      style={[
        styles.backArrowBtn,
        {
          top: insets.top + 8,
          left: Layout.screenPaddingHorizontal,
          backgroundColor: colors.surface,
          borderColor: isDark ? colors.border : Theme.borderMedium,
        },
      ]}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Back to fleets"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <FontAwesome name="chevron-left" size={14} color={isDark ? colors.text : Theme.driverCtaFill} />
    </TouchableOpacity>
    </View>
    <Modal
      visible={!!whatsAppReminderMessage}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={() => setWhatsAppReminderMessage(null)}
    >
      <Pressable
        style={[
          styles.walletDialogOverlay,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            backgroundColor: isDark ? 'rgba(2,6,23,0.68)' : 'rgba(15,23,42,0.28)',
          },
        ]}
        onPress={() => setWhatsAppReminderMessage(null)}
      >
        <Pressable
          style={[
            styles.walletDialogCard,
            {
              backgroundColor: isDark ? colors.surfaceElevated : '#ffffff',
              borderColor: isDark ? colors.borderSubtle : 'rgba(226,232,240,0.95)',
              shadowColor: isDark ? '#000000' : 'rgba(15,23,42,0.18)',
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.walletDialogAccent, { backgroundColor: colors.emerald }]} />
          <View
            style={[
              styles.walletDialogIconWrap,
              { backgroundColor: isDark ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.10)' },
            ]}
          >
            <FontAwesome name="whatsapp" size={26} color={colors.emerald} />
          </View>
          <Text style={[styles.walletDialogTitle, { color: colors.text }]}>Reminder sent</Text>
          <Text style={[styles.walletDialogMessage, { color: colors.textMuted }]}>
            The fleet owner has been notified in app. Send a WhatsApp reminder too?
          </Text>
          <View
            style={[
              styles.walletDialogInfoChip,
              {
                backgroundColor: isDark ? colors.surface : 'rgba(241,245,249,0.82)',
                borderColor: isDark ? colors.borderSubtle : 'rgba(226,232,240,0.9)',
              },
            ]}
          >
            <FontAwesome name="bell-o" size={12} color={colors.emerald} />
            <Text style={[styles.walletDialogInfoChipText, { color: colors.textMuted }]}>In-app reminder created</Text>
          </View>
          <View style={styles.walletDialogButtons}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[
                styles.walletDialogButton,
                styles.walletDialogButtonSecondary,
                {
                  backgroundColor: isDark ? colors.surface : 'rgba(241,245,249,0.92)',
                  borderColor: isDark ? colors.borderSubtle : 'rgba(226,232,240,0.95)',
                },
              ]}
              onPress={() => setWhatsAppReminderMessage(null)}
            >
              <Text style={[styles.walletDialogButtonSecondaryText, { color: colors.text }]}>Not now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[
                styles.walletDialogButton,
                styles.walletDialogButtonPrimary,
                { backgroundColor: colors.emerald, shadowColor: isDark ? '#000' : 'rgba(16,185,129,0.32)' },
              ]}
              onPress={() => {
                const message = whatsAppReminderMessage;
                setWhatsAppReminderMessage(null);
                if (message) void openWhatsAppReminder(message);
              }}
            >
              <FontAwesome name="whatsapp" size={16} color={colors.textOnPrimary} />
              <Text style={[styles.walletDialogButtonPrimaryText, { color: colors.textOnPrimary }]}>Send on WhatsApp</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    <DriverLedgerReceiptPreviewModal
      visible={!!ledgerReceiptPreview}
      receipt={ledgerReceiptPreview}
      onClose={() => setLedgerReceiptPreview(null)}
    />
    <ThemedConfirmModal
      variant="positive"
      visible={!!markPaidConfirmState}
      title="Verify fleet payment update"
      message={
        markPaidConfirmState
          ? (() => {
              const tripDisplay = getDriverTripDisplayNumber(markPaidConfirmState.trip, driverTripNumberById);
              const amountStr = `₹${Math.round(markPaidConfirmState.amount).toLocaleString('en-IN')}`;
              const sourceDesc = markPaidConfirmState.sourceLedger?.description ?? null;
              const mode = derivePaymentMode(sourceDesc) ?? 'BANK TRANSFER';
              const utr = extractUtr(sourceDesc) ?? '—';
              return `Fleet owner marked ${tripDisplay} as paid for ${amountStr} (Mode: ${mode}, UTR: ${utr}). Confirm to sync this into your passbook and cash balance.`;
            })()
          : ''
      }
      cancelText="Cancel"
      confirmText={markPaidLoadingTripId && markPaidConfirmState ? 'Saving...' : 'Proceed'}
      confirmVariant="primary"
      onCancel={() => {
        if (!markPaidLoadingTripId) setMarkPaidConfirmState(null);
      }}
      onConfirm={() => {
        const next = markPaidConfirmState;
        if (!next) return;
        setMarkPaidConfirmState(null);
        void markTripAsPaid(next.trip, next.amount, next.sourceLedger ?? null);
      }}
    />
    <ThemedConfirmModal
      variant="positive"
      visible={!!settledSuccessState}
      title="Payment settled"
      message={
        settledSuccessState
          ? `${settledSuccessState.tripDisplay} · ₹${settledSuccessState.amount.toLocaleString('en-IN')} has been verified and marked as settled. Your cash balance is updated.`
          : ''
      }
      cancelText="Done"
      confirmText="View settled"
      onCancel={() => setSettledSuccessState(null)}
      onConfirm={() => {
        setSettledSuccessState(null);
        setJourneyFilter('settled');
      }}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14 },
  backArrowBtn: {
    position: 'absolute',
    zIndex: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    shadowColor: 'rgba(15,23,42,0.08)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  fleetHero: {
    marginHorizontal: Layout.screenPaddingHorizontal,
    borderRadius: 22,
    padding: 14,
    overflow: 'hidden',
    shadowColor: 'rgba(11,79,63,0.28)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  fleetHeroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 10,
  },
  fleetHeroTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  fleetHeroTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: Theme.textOnPrimary,
    marginBottom: 4,
  },
  fleetHeroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
  },
  fleetHeroMetaText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: Theme.textOnPrimary,
  },
  fleetHeroMetaDot: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.tripsMint,
  },
  fleetHeroActivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Theme.driverWhiteMutedStrong,
  },
  fleetHeroActiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Theme.tripsMint,
  },
  fleetHeroActiveText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: Theme.textOnPrimary,
  },
  fleetHeroPayTermsWrap: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fleetHeroPayTermPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Theme.driverWhiteMutedStrong,
    backgroundColor: Theme.driverWhiteMuted,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fleetHeroPayTermLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Theme.textOnPrimary,
  },
  fleetHeroPayTermValue: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.textOnPrimary,
  },
  fleetHeroIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.driverWhiteMutedStrong,
  },
  fleetHeroIconImage: {
    width: '100%',
    height: '100%',
  },
  fleetHeroStatsCard: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: 'rgba(15,23,42,0.12)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 4,
  },
  fleetHeroPendingLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  fleetHeroPendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fleetHeroPendingAmount: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  fleetHeroBoltBadge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: Theme.driverEmeraldMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
  },
  fleetHeroStatsHairline: {
    height: 1,
    marginTop: 10,
    marginBottom: 10,
  },
  fleetHeroStatsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  payTermsPrompt: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  payTermsPromptText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  payTermsPromptTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  payTermsPromptBody: {
    fontSize: 11,
    lineHeight: 15,
  },
  fleetHeroStat: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  fleetHeroStatDivider: {
    width: 1,
    alignSelf: 'stretch',
  },
  fleetHeroStatLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fleetHeroStatValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  mainTabsWrap: {
    marginTop: 16,
    marginHorizontal: Layout.screenPaddingHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    padding: 4,
    gap: 4,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
      },
      android: { elevation: 0 },
      default: {},
    }),
  },
  mainTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    borderRadius: 999,
  },
  mainTabActive: {
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  mainTabText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  searchSection: {
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 14,
    gap: 12,
  },
  searchBar: {
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    borderRadius: 16,
    minHeight: 48,
    shadowColor: 'rgba(15,23,42,0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 2,
  },
  filterChipScrollWrap: {
    minHeight: 34,
    marginTop: 2,
  },
  filterChipRow: {
    gap: 8,
    paddingRight: 4,
    paddingBottom: 2,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  filterChipText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  bulkClaimButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 18,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 26,
    elevation: 10,
  },
  bulkClaimButtonText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    color: Theme.buttonPrimaryText,
  },
  ledgerSection: {
    paddingTop: 16,
  },
  transactionHistoryTitle: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  walletDialogOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  walletDialogCard: {
    width: '100%',
    maxWidth: 368,
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 20,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 1,
    shadowRadius: 36,
    elevation: 18,
  },
  walletDialogAccent: {
    width: 88,
    height: 4,
    borderRadius: 999,
    marginBottom: 18,
  },
  walletDialogIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  walletDialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  walletDialogMessage: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: 280,
  },
  walletDialogInfoChip: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  walletDialogInfoChipText: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  walletDialogButtons: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  walletDialogButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    flexDirection: 'row',
    gap: 8,
  },
  walletDialogButtonPrimary: {
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 6,
  },
  walletDialogButtonSecondary: {
    borderWidth: 1,
  },
  walletDialogButtonPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  walletDialogButtonSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  tripsPremiumWrapPassbook: {
    gap: 16,
    paddingBottom: 12,
  },
  tripsPremiumSectionPassbook: {
    gap: 8,
  },
  tripsSectionHeaderRowPassbook: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 2,
  },
  earningsSectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 3,
    shadowColor: 'rgba(16,185,129,0.45)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 6,
  },
  tripsPremiumSectionLabelPassbook: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: 2,
  },
  tripsTimelineListPassbook: {
    gap: 12,
  },
  passbookTripCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    overflow: 'hidden',
    shadowColor: 'rgba(15,23,42,0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 3,
  },
  passbookTripTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  passbookTripIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  passbookTripIconImage: {
    width: '100%',
    height: '100%',
  },
  passbookTripHead: {
    flex: 1,
    minWidth: 0,
  },
  passbookTripId: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  passbookTripMeta: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  passbookTripSubStatus: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 4,
    lineHeight: 14,
  },
  passbookTripRight: {
    alignItems: 'flex-end',
    gap: 8,
    flexShrink: 0,
    maxWidth: '42%',
  },
  passbookTripAmount: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  passbookTripStatusPill: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
  },
  passbookTripStatusInfo: {
    backgroundColor: '#eff6ff',
    color: '#2563eb',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  passbookTripStatusSuccess: {
    backgroundColor: '#ecfdf5',
    color: '#059669',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  passbookRouteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  passbookRouteSide: {
    flex: 1,
    minWidth: 0,
  },
  passbookRouteSideRight: {
    alignItems: 'flex-end',
  },
  passbookRouteLabel: {
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  passbookRouteValue: {
    fontSize: 11,
    fontWeight: '700',
  },
  passbookRouteMiddle: {
    alignItems: 'center',
    width: 44,
  },
  passbookRouteDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  passbookRouteLine: {
    width: 2,
    height: 18,
    marginVertical: 3,
    borderRadius: 1,
  },
  tripActionWrap: {
    marginTop: 14,
    gap: 10,
    alignSelf: 'stretch',
    width: '100%',
  },
  tripActionFull: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
  },
  tripActionHint: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tripActionHintText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  tripVerifyBtn: {
    width: '100%',
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
  },
  tripVerifyBtnText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: Theme.buttonPrimaryText,
  },
  cashPremiumWrap: {
    gap: 16,
    paddingBottom: 24,
  },
  cashPremiumSection: {
    gap: 8,
  },
  cashPremiumSectionLabel: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 2,
  },
  cashPremiumGroup: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: 'rgba(15,23,42,0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 3,
  },
  cashPremiumRow: {
    paddingHorizontal: 6,
  },
  cashPremiumRowTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: 'space-between',
  },
  cashPremiumLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  cashPremiumAvatar: {
    width: 40,
    height: 40,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashPremiumAvatarImageClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
  },
  cashPremiumAvatarImage: {
    width: '100%',
    height: '100%',
  },
  cashPremiumAvatarText: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  cashPremiumAvatarBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.7)',
    zIndex: 2,
    elevation: 4,
  },
  cashPremiumBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  cashPremiumSource: {
    ...FinanceTxnTypography.partyTitle,
    fontWeight: '300',
    letterSpacing: -0.5,
  },
  cashPremiumMethod: {
    ...FinanceTxnTypography.dateLine,
    marginTop: 4,
  },
  cashPremiumRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  cashPremiumRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  cashPremiumAmount: {
    fontSize: 13,
    fontWeight: '600',
    fontStyle: 'italic',
    letterSpacing: -0.2,
  },
  cashPremiumStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cashPremiumStatus: {
    fontSize: 8,
    fontWeight: '600',
    fontStyle: 'italic',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  cashPremiumChevronExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  cashPremiumReceiptWrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 16,
    alignItems: 'center',
  },
  cashPremiumReceiptCard: {
    borderWidth: 1,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: 'rgba(16,185,129,0.18)',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 34,
    elevation: 10,
    width: '100%',
    maxWidth: 720,
  },
  cashPremiumReceiptHero: {
    alignItems: 'center',
    paddingTop: 22,
    paddingBottom: 18,
    paddingHorizontal: 18,
  },
  cashPremiumReceiptIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cashPremiumReceiptEyebrow: {
    fontSize: 8,
    fontWeight: '400',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 6,
  },
  cashPremiumReceiptAmount: {
    fontSize: 28,
    fontWeight: '500',
    letterSpacing: -1,
  },
  cashPremiumReceiptMeta: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 10,
  },
  cashPremiumReceiptMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cashPremiumReceiptMetaLabel: {
    fontSize: 8,
    fontWeight: '400',
    textTransform: 'uppercase',
    letterSpacing: 1.7,
    minWidth: 128,
  },
  cashPremiumReceiptMetaValue: {
    fontSize: 11,
    fontWeight: '400',
    textAlign: 'right',
    flexShrink: 1,
  },
  cashPremiumReceiptBankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  cashPremiumReceiptActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 18,
  },
  cashPremiumReceiptButtonSecondary: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cashPremiumReceiptButtonSecondaryText: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  cashPremiumReceiptButtonPrimary: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 14,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cashPremiumReceiptButtonPrimaryText: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    color: Theme.textOnPrimary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.driverHeaderHorizontalPadding,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle: { ...Typography.headerTitle },
  headerSubtitle: { ...Typography.headerSubtitle, marginTop: 2 },
  headerLeftAt: { fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  summaryCard: {
    marginHorizontal: 24,
    marginTop: 24,
    padding: 22,
    borderRadius: 18,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 1,
    shadowRadius: 26,
    elevation: 8,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  summaryIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 3,
  },
  summarySubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  summaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  summaryBadgeText: {
    fontSize: 8,
    fontWeight: '400',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  summaryStats: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  summaryStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryStatLabel: {
    fontSize: 8,
    fontWeight: '400',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  summaryStatValue: {
    fontSize: 15,
    fontWeight: '500',
  },
  section: { marginTop: 28 },
  gpayListSection: { marginHorizontal: Layout.screenPaddingHorizontal },
  salaryCard: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowColor: 'rgba(15,23,42,0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sectionSubtitle: { fontSize: 11, fontWeight: '400', marginBottom: 12, lineHeight: 16 },
  ledgerCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  ledgerEmpty: { padding: 32, alignItems: 'center', gap: 12 },
  ledgerEmptyText: { fontSize: 14 },
  tripBlock: { borderBottomWidth: 1 },
  receivedSubrow: { paddingVertical: 10, paddingLeft: 52 },
  emptyCard: {
    marginTop: 28,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '500', marginTop: 16 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  ppTxCard: {
    paddingVertical: 14,
    paddingHorizontal: 0,
  },
  ppTxTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  ppIconSq: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  ppMiddle: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  ppPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  ppPrimary: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  txStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  txStatusPillText: {
    fontSize: 8,
    fontWeight: '400',
    letterSpacing: 2,
  },
  ppSecondary: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 4,
    lineHeight: 18,
    letterSpacing: 0,
  },
  ppAmount: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.2,
    flexShrink: 0,
    maxWidth: '40%',
    textAlign: 'right',
  },
  ppMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingLeft: 58,
    paddingRight: 2,
  },
  ppMetaLeft: {
    fontSize: 12,
    fontWeight: '400',
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  ppMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    maxWidth: '52%',
    justifyContent: 'flex-end',
  },
  ppMetaRightText: {
    fontSize: 12,
    fontWeight: '400',
    textAlign: 'right',
    flexShrink: 1,
  },
  ppMetaBankIcon: {
    marginTop: 1,
  },
});
