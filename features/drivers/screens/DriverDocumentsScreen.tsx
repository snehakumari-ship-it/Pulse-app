import { Alert, View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Modal } from 'react-native';
import { DocumentSearchMotion } from '@/components/driver/DocumentSearchMotion';
import { DriverMotionIcon } from '@/components/driver/DriverMotionIcon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import Theme from '@/constants/Theme';
import {
  DRIVER_DETAIL_HORIZONTAL_PAD,
  DriverSubScreenHeader,
} from '@/components/driver/DriverSubScreenHeader';
import { useDriverTheme, useDriverThemeColors } from '@/contexts/DriverThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { subscribeSharedPostgresChanges } from '@/lib/realtimeRegistry';
import {
  listMyDriverKycDocuments,
  submitDriverKycDocument,
  latestDriverKycDocument,
  getMyDriverKycSubmission,
  submitDriverKycForVerification,
  listDriverKycDocRequirements,
  withdrawDriverKycDocument,
  MANDATORY_DRIVER_KYC_DOC_TYPES,
  type DriverKycDocType,
  type DriverKycDocument,
  type DriverKycSubmission,
  type DriverKycDocRequirement,
} from '@/features/drivers/services/driverKycDocuments.service';
import * as Linking from 'expo-linking';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';

const DOC_DEFS: { key: DriverKycDocType; label: string; icon: keyof typeof FontAwesome.glyphMap }[] = [
  { key: 'license', label: 'Driving license', icon: 'car' },
  { key: 'aadhaar', label: 'Aadhaar', icon: 'id-card' },
  { key: 'pan', label: 'PAN', icon: 'credit-card' },
  { key: 'selfie', label: 'Selfie', icon: 'user-circle' },
];

function normalizeDocMimeType(rawMime: string | null | undefined): string {
  const mime = (rawMime ?? '').toLowerCase();
  if (mime.includes('png')) return 'image/png';
  if (mime.includes('webp')) return 'image/webp';
  if (mime.includes('pdf')) return 'application/pdf';
  return 'image/jpeg';
}

function base64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/\s/g, '');
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const maybeBuffer = (globalThis as { Buffer?: { from: (value: string, enc: string) => Uint8Array } }).Buffer;
  if (maybeBuffer?.from) return maybeBuffer.from(normalized, 'base64');
  throw new Error('Base64 decoding is not available on this device');
}

async function readAssetBytes(uri: string, base64?: string): Promise<ArrayBuffer | Uint8Array> {
  if (typeof base64 === 'string' && base64.trim().length > 0) {
    return base64ToUint8Array(base64.trim());
  }

  // Web picker commonly returns blob: URLs; fetch() reads these reliably.
  try {
    const response = await fetch(uri);
    if (response.ok) {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 0) return bytes;
    }
  } catch {
    // fall through to expo-file-system
  }

  const bytes = await new File(uri).arrayBuffer();
  if (bytes.byteLength === 0) throw new Error('Could not read selected document');
  return bytes;
}

function formatDocDate(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

type DocStatusMeta = {
  label: string;
  color: string;
  icon: keyof typeof FontAwesome.glyphMap;
};

function statusMeta(
  doc: DriverKycDocument | undefined,
  uploading: boolean,
  muted: string,
): DocStatusMeta {
  if (uploading) return { label: 'Uploading', color: Theme.assignmentVehicleAccent, icon: 'refresh' };
  if (!doc?.storage_path) return { label: 'Not added', color: muted, icon: 'circle-o' };
  switch (doc.status) {
    case 'verified':
      return { label: 'Verified', color: Theme.complianceStageSuccessFg, icon: 'check-circle' };
    case 'rejected':
      return { label: 'Rejected', color: Theme.negative, icon: 'times-circle' };
    case 'expired':
      return { label: 'Expired', color: Theme.negative, icon: 'clock-o' };
    default:
      return { label: 'Pending', color: Theme.assignmentVehicleAccent, icon: 'dot-circle-o' };
  }
}

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { theme } = useDriverTheme();
  const isDark = theme === 'dark';
  const colors = useDriverThemeColors();
  const pageBg = isDark ? colors.background : Theme.surfaceGray;
  const [documents, setDocuments] = useState<DriverKycDocument[]>([]);
  const [uploadingDocKey, setUploadingDocKey] = useState<DriverKycDocType | null>(null);
  const [submission, setSubmission] = useState<DriverKycSubmission | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requirements, setRequirements] = useState<DriverKycDocRequirement[]>([]);
  const [rejectedOptionalSheet, setRejectedOptionalSheet] = useState<{
    docId: string;
    docType: DriverKycDocType;
    label: string;
    reason: string | null;
  } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  /** Mandatory types from the server when available, constant as fallback. */
  const mandatoryTypes: readonly DriverKycDocType[] = requirements.length
    ? requirements.filter((r) => r.is_mandatory).map((r) => r.doc_type)
    : MANDATORY_DRIVER_KYC_DOC_TYPES;
  const isOptionalDoc = (type: DriverKycDocType) => !mandatoryTypes.includes(type);

  const docsByType = useMemo(() => {
    const map = new Map<DriverKycDocType, DriverKycDocument>();
    for (const def of DOC_DEFS) {
      const latest = latestDriverKycDocument(documents, def.key);
      if (latest) map.set(def.key, latest);
    }
    return map;
  }, [documents]);
  const uploadedCount = DOC_DEFS.filter((d) => docsByType.get(d.key)?.storage_path).length;

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(driver)/profile');
  };

  const loadDocuments = useCallback(async () => {
    const { documents: docs } = await listMyDriverKycDocuments();
    setDocuments(docs);
    const { submission: sub } = await getMyDriverKycSubmission();
    setSubmission(sub);
    setRequirements(await listDriverKycDocRequirements());
  }, []);

  // Submit unlocks only when every mandatory doc is uploaded and none is still
  // carrying a rejection — the same rule the RPC enforces server-side. A doc
  // the driver has replaced is back to 'pending', so it no longer blocks.
  // Only rejected MANDATORY documents block submission — same rule the RPC
  // enforces. A rejected optional doc can be re-uploaded or withdrawn, so it
  // must not gate the button.
  const rejectedDocTypes = mandatoryTypes.filter(
    (type) => docsByType.get(type)?.status === 'rejected',
  );
  const rejectedOptionalTypes = DOC_DEFS.map((d) => d.key).filter(
    (type) => isOptionalDoc(type) && docsByType.get(type)?.status === 'rejected',
  );
  // Only mandatory documents gate submission, so a driver with no PAN card
  // can still get verified.
  const missingDocCount = mandatoryTypes.filter(
    (type) => !docsByType.get(type)?.storage_path,
  ).length;
  const allMandatoryReady = missingDocCount === 0 && rejectedDocTypes.length === 0;

  const awaitingReview = submission?.review_status === 'submitted';
  const isApproved = submission?.review_status === 'approved';
  const wasRejected = submission?.review_status === 'rejected';
  // Approved is terminal; awaiting review has nothing to do. Everything else —
  // including a rejected submission — must be able to submit again, otherwise
  // a rejected driver is locked out of the queue permanently.
  const canSubmitAgain = !awaitingReview && !isApproved;

  const submitLabel = (): string => {
    if (submitting) return 'Submitting...';
    if (missingDocCount > 0) {
      return `Upload ${missingDocCount} more required document${missingDocCount === 1 ? '' : 's'}`;
    }
    if (rejectedDocTypes.length > 0) return 'Replace the rejected documents first';
    return wasRejected ? 'Re-submit for verification' : 'Submit for verification';
  };

  const handleSubmitForVerification = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { error } = await submitDriverKycForVerification();
      if (error) {
        Alert.alert('Could not submit', error.message);
        return;
      }
      await loadDocuments();
      Alert.alert('Submitted', 'Your documents are now with our team for verification.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  // Realtime: admin approves/rejects → driver sees it immediately, no polling.
  // Shared channel keyed per-driver so re-mounting this screen doesn't open a
  // second subscription for the same user (registry dedupes by key).
  useEffect(() => {
    if (!profile?.uid) return;
    const unsubscribe = subscribeSharedPostgresChanges(
      `driver-kyc-docs:${profile.uid}`,
      [
        {
          event: '*',
          schema: 'public',
          table: 'driver_kyc_documents',
          filter: `driver_user_id=eq.${profile.uid}`,
        },
      ],
      () => {
        void loadDocuments();
      },
    );
    return unsubscribe;
  }, [profile?.uid, loadDocuments]);

  const openDocument = async (doc: DriverKycDocument | undefined) => {
    if (!doc?.storage_path?.trim()) return;
    try {
      const { data, error } = await supabase()
        .storage
        .from('driver-documents')
        .createSignedUrl(doc.storage_path, 60 * 10);
      if (error || !data?.signedUrl) {
        Alert.alert('Preview unavailable', error?.message || 'Could not open document.');
        return;
      }
      await Linking.openURL(data.signedUrl);
    } catch (e) {
      Alert.alert('Preview unavailable', e instanceof Error ? e.message : 'Could not open document.');
    }
  };

  const uploadDocumentFrom = async (
    docType: DriverKycDocType,
    label: string,
    source: 'gallery' | 'camera',
  ) => {
    if (!profile?.uid || uploadingDocKey) return;
    setUploadingDocKey(docType);
    try {
      // Web has no media-library permission model — the browser's own file
      // dialog is the consent step. Requesting it there can resolve un-granted
      // and block a picker that would otherwise work fine.
      if (Platform.OS === 'web') {
        // no-op: fall through to launchImageLibraryAsync
      } else if (source === 'gallery') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission required', 'Photo library access is needed to upload this document.');
          return;
        }
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission required', 'Camera access is needed to capture this document.');
          return;
        }
      }

      const result =
        source === 'gallery'
          ? await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing: false,
              quality: 0.9,
              base64: true,
            })
          : await ImagePicker.launchCameraAsync({
              allowsEditing: false,
              quality: 0.9,
              base64: true,
            });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const mimeType = normalizeDocMimeType(asset.mimeType);
      const extByMime =
        mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/webp'
            ? 'webp'
            : mimeType === 'application/pdf'
              ? 'pdf'
              : 'jpg';
      const ext = (asset.fileName?.split('.').pop() || extByMime).toLowerCase();
      const path = `${profile.uid}/${docType}-${Date.now()}.${ext}`;
      const uploadBytes = await readAssetBytes(asset.uri, typeof asset.base64 === 'string' ? asset.base64 : undefined);

      const { error: uploadError } = await supabase()
        .storage
        .from('driver-documents')
        .upload(path, uploadBytes, {
          contentType: mimeType,
          upsert: true,
        });
      if (uploadError) {
        Alert.alert('Upload failed', uploadError.message || `Could not upload ${label}.`);
        return;
      }

      const { error: submitError } = await submitDriverKycDocument({
        doc_type: docType,
        storage_path: path,
        file_name: asset.fileName ?? `${docType}.${ext}`,
        mime_type: mimeType,
        file_size_bytes: asset.fileSize ?? undefined,
      });
      if (submitError) {
        Alert.alert('Uploaded with warning', `File uploaded, but status sync failed: ${submitError.message}`);
      }

      await loadDocuments();
      Alert.alert('Submitted', `${label} submitted for review.`);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : `Could not upload ${label}.`);
    } finally {
      setUploadingDocKey(null);
    }
  };

  const handleWithdraw = async (documentId: string, label: string) => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      const { error } = await withdrawDriverKycDocument(documentId);
      if (error) {
        Alert.alert('Could not remove', error.message);
        return;
      }
      setRejectedOptionalSheet(null);
      await loadDocuments();
      Alert.alert('Removed', `${label} removed. You can submit without it.`);
    } finally {
      setWithdrawing(false);
    }
  };

  const onDocumentPress = (docType: DriverKycDocType, label: string) => {
    const doc = docsByType.get(docType);
    const canReupload = !doc?.storage_path || doc.status === 'rejected' || doc.status === 'expired';

    // A rejected OPTIONAL document must be escapable: a driver who uploaded the
    // wrong file because they have no PAN at all would otherwise be stuck
    // forever, unable to fix it and unable to remove it. Needs three choices,
    // so it gets a real sheet rather than a two-button Alert/confirm.
    if (doc?.id && doc.status === 'rejected' && isOptionalDoc(docType)) {
      setRejectedOptionalSheet({
        docId: doc.id,
        docType,
        label,
        reason: doc.rejection_notes ?? null,
      });
      return;
    }

    if (doc?.storage_path && !canReupload) {
      // Verified or pending — view only. Pending review shouldn't be silently
      // overwritten while an admin may already be looking at it.
      void openDocument(doc);
      return;
    }

    // RN Web's Alert.alert renders a window.confirm and silently ignores any
    // button past the first two, so the Gallery/Camera sheet never appears on
    // web. Web has no camera roll distinction anyway — go straight to the
    // file picker, which is what the browser's own dialog provides.
    if (Platform.OS === 'web') {
      void uploadDocumentFrom(docType, label, 'gallery');
      return;
    }

    const actions: { text: string; onPress?: () => void; style?: 'cancel' }[] = [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Gallery', onPress: () => void uploadDocumentFrom(docType, label, 'gallery') },
      { text: 'Camera', onPress: () => void uploadDocumentFrom(docType, label, 'camera') },
    ];
    if (doc?.storage_path) {
      actions.splice(1, 0, { text: 'View current', onPress: () => void openDocument(doc) });
    }
    Alert.alert(
      label,
      doc?.status === 'rejected' && doc.rejection_notes
        ? `Rejected: ${doc.rejection_notes}\n\nUpload a new one?`
        : 'Upload this document now?',
      actions,
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: pageBg }]}>
      <DriverSubScreenHeader title="KYC & documents" onBack={handleBack} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: DRIVER_DETAIL_HORIZONTAL_PAD,
          paddingBottom: insets.bottom + 80,
          paddingTop: 16,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLead, { color: colors.text }]}>Verification upgrade</Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
          Upload and verify your proof of identity. One place for all driver compliance.
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
          {mandatoryTypes.length - missingDocCount}/{mandatoryTypes.length} required uploaded
          {uploadedCount > mandatoryTypes.length - missingDocCount
            ? ` · ${uploadedCount - (mandatoryTypes.length - missingDocCount)} optional`
            : ''}
        </Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.tableHead, { borderBottomColor: colors.border }]}>
            <View style={styles.nameCol}>
              <View style={styles.headIconSpacer} />
              <Text style={[styles.headLabel, { color: colors.textMuted }]}>Document</Text>
            </View>
            <View style={styles.typeCol}>
              <Text style={[styles.headLabel, { color: colors.textMuted }]}>Type</Text>
            </View>
            <View style={styles.statusCol}>
              <Text style={[styles.headLabel, { color: colors.textMuted }]}>Status</Text>
            </View>
          </View>
          {DOC_DEFS.map((def, idx) => {
            const doc = docsByType.get(def.key);
            const optional = isOptionalDoc(def.key);
            const status = statusMeta(doc, uploadingDocKey === def.key, colors.textMuted);
            const uploadedOn = doc?.storage_path ? formatDocDate(doc.created_at) : null;
            return (
              <TouchableOpacity
                key={def.key}
                style={[
                  styles.docRow,
                  idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
                onPress={() => onDocumentPress(def.key, def.label)}
                activeOpacity={0.7}
                disabled={uploadingDocKey != null}
              >
                <View style={styles.nameCol}>
                  <View style={[styles.docRowIcon, { backgroundColor: colors.emeraldMuted }]}>
                    <DriverMotionIcon delay={idx * 160}>
                      <FontAwesome name={def.icon} size={13} color={colors.emerald} />
                    </DriverMotionIcon>
                  </View>
                  <View style={styles.docRowLabelCol}>
                    <Text style={[styles.docRowLabel, { color: colors.text }]} numberOfLines={2}>
                      {def.label}
                    </Text>
                    {uploadedOn ? (
                      <Text style={[styles.docRowDate, { color: colors.textMuted }]} numberOfLines={1}>
                        {uploadedOn}
                      </Text>
                    ) : null}
                    {doc?.status === 'rejected' && doc.rejection_notes ? (
                      <Text style={[styles.docRowReason, { color: Theme.negative }]} numberOfLines={2}>
                        {doc.rejection_notes}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.typeCol}>
                  <View
                    style={[
                      styles.typePill,
                      {
                        backgroundColor: optional
                          ? Theme.complianceStageInfoBg
                          : Theme.complianceStagePendingBg,
                      },
                    ]}
                  >
                    <FontAwesome
                      name={optional ? 'circle-o' : 'asterisk'}
                      size={9}
                      color={optional ? Theme.complianceStageInfoFg : Theme.complianceStagePendingFg}
                    />
                    <Text
                      style={[
                        styles.typePillText,
                        { color: optional ? Theme.complianceStageInfoFg : Theme.complianceStagePendingFg },
                      ]}
                      numberOfLines={1}
                    >
                      {optional ? 'Optional' : 'Required'}
                    </Text>
                  </View>
                </View>
                <View style={styles.statusCol}>
                  <FontAwesome name={status.icon} size={12} color={status.color} />
                  <Text style={[styles.statusText, { color: status.color }]} numberOfLines={1}>
                    {status.label}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {submission ? (
          <View style={[styles.submitStatusCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
            <Text style={[styles.submitStatusTitle, { color: colors.text }]}>
              {submission.review_status === 'approved'
                ? 'Verification approved'
                : submission.review_status === 'rejected'
                  ? 'Verification rejected'
                  : 'Awaiting verification'}
            </Text>
            <Text style={[styles.submitStatusBody, { color: colors.textMuted }]}>
              {submission.review_status === 'submitted'
                ? 'Our team is reviewing your documents. You will be notified once done.'
                : submission.review_notes || 'Reviewed by our verification team.'}
            </Text>
            {wasRejected && rejectedDocTypes.length > 0 ? (
              <Text style={[styles.submitStatusAction, { color: Theme.negative }]}>
                Tap to re-upload:{' '}
                {rejectedDocTypes
                  .map((t) => DOC_DEFS.find((d) => d.key === t)?.label ?? t)
                  .join(', ')}
              </Text>
            ) : null}
            {wasRejected && rejectedDocTypes.length === 0 ? (
              <Text style={[styles.submitStatusAction, { color: colors.emerald }]}>
                Documents replaced — re-submit below.
              </Text>
            ) : null}
          </View>
        ) : null}

        {rejectedOptionalTypes.length > 0 ? (
          <Text style={[styles.optionalHint, { color: colors.textMuted }]}>
            {rejectedOptionalTypes
              .map((t) => DOC_DEFS.find((d) => d.key === t)?.label ?? t)
              .join(', ')}{' '}
            was rejected but isn&apos;t required — tap it to upload a new file, or to remove it
            if you don&apos;t have one.
          </Text>
        ) : null}

        {canSubmitAgain ? (
          <TouchableOpacity
            style={[
              styles.submitBtn,
              {
                backgroundColor: allMandatoryReady ? colors.emerald : colors.border,
                opacity: submitting ? 0.6 : 1,
              },
            ]}
            onPress={() => void handleSubmitForVerification()}
            activeOpacity={0.85}
            disabled={!allMandatoryReady || submitting}
          >
            <Text
              style={[
                styles.submitBtnText,
                { color: allMandatoryReady ? '#fff' : colors.textMuted },
              ]}
            >
              {submitLabel()}
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.reviewMotionSlot}>
          <DocumentSearchMotion />
        </View>
      </ScrollView>

      {/* Rejected optional document → three real choices, not a browser confirm. */}
      <Modal
        visible={rejectedOptionalSheet !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectedOptionalSheet(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View
            style={[
              styles.sheetCard,
              { backgroundColor: colors.surface, paddingBottom: insets.bottom + 20 },
            ]}
          >
            <View style={[styles.sheetIcon, { backgroundColor: Theme.negativeMuted }]}>
              <FontAwesome name="exclamation" size={16} color={Theme.negative} />
            </View>

            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {rejectedOptionalSheet?.label} was rejected
            </Text>

            {rejectedOptionalSheet?.reason ? (
              <Text style={[styles.sheetReason, { color: Theme.negative }]}>
                {rejectedOptionalSheet.reason}
              </Text>
            ) : null}

            <Text style={[styles.sheetBody, { color: colors.textMuted }]}>
              This document is optional. Upload a corrected copy, or remove it if you
              don&apos;t have one — either way you can continue.
            </Text>

            <TouchableOpacity
              style={[styles.sheetPrimaryBtn, { backgroundColor: colors.emerald }]}
              activeOpacity={0.85}
              disabled={withdrawing}
              onPress={() => {
                const sheet = rejectedOptionalSheet;
                setRejectedOptionalSheet(null);
                if (sheet) void uploadDocumentFrom(sheet.docType, sheet.label, 'gallery');
              }}
            >
              <Text style={styles.sheetPrimaryBtnText}>Upload a new file</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetSecondaryBtn, { borderColor: colors.border }]}
              activeOpacity={0.85}
              disabled={withdrawing}
              onPress={() => {
                if (rejectedOptionalSheet) {
                  void handleWithdraw(
                    rejectedOptionalSheet.docId,
                    rejectedOptionalSheet.label,
                  );
                }
              }}
            >
              <Text style={[styles.sheetSecondaryBtnText, { color: Theme.negative }]}>
                {withdrawing
                  ? 'Removing...'
                  : `I don't have a ${rejectedOptionalSheet?.label ?? 'document'}`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetCancelBtn}
              activeOpacity={0.7}
              disabled={withdrawing}
              onPress={() => setRejectedOptionalSheet(null)}
            >
              <Text style={[styles.sheetCancelBtnText, { color: colors.textMuted }]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  submitBtn: {
    marginTop: 16,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: { fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
  reviewMotionSlot: {
    flexGrow: 1,
    minHeight: 168,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitStatusCard: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  submitStatusTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  submitStatusBody: { fontSize: 12, lineHeight: 17 },
  submitStatusAction: { fontSize: 12, fontWeight: '600', lineHeight: 17, marginTop: 6 },
  optionalHint: { fontSize: 12, lineHeight: 17, marginTop: 14, paddingHorizontal: 2 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 22,
    alignItems: 'center',
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  sheetIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  sheetReason: { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 6 },
  sheetBody: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  sheetPrimaryBtn: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetPrimaryBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  sheetSecondaryBtn: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 10,
  },
  sheetSecondaryBtnText: { fontSize: 14, fontWeight: '700' },
  sheetCancelBtn: { paddingVertical: 14, marginTop: 4 },
  sheetCancelBtnText: { fontSize: 13, fontWeight: '600' },
  sectionLead: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  sectionCard: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.driverSecondaryGrey,
    backgroundColor: Theme.cardWhite,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  headIconSpacer: { width: 28 },
  nameCol: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeCol: { width: 78, alignItems: 'flex-start', justifyContent: 'center' },
  statusCol: {
    width: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  docRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docRowLabelCol: { flex: 1, minWidth: 0, gap: 2 },
  docRowLabel: { fontSize: 13, fontWeight: '700' },
  docRowDate: { fontSize: 11, fontWeight: '500' },
  docRowReason: { fontSize: 11, fontWeight: '500', lineHeight: 15 },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
  },
  typePillText: { fontSize: 10, fontWeight: '600' },
  statusText: { flex: 1, fontSize: 11, fontWeight: '600' },
});
