/**
 * Edit profile modal — full name, phone, company name, profile photo, status.
 * Driver layout matches reference: hero avatar + sectioned form + primary Save; avatar tap opens action sheet.
 * Avatar: profile.avatar_url (signed) or preset (driver / user-2d). Colors from Theme only.
 */
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DriverIconWell, driverIconSize } from '@/components/driver/DriverIconWell';
import { DriverMotionIcon } from '@/components/driver/DriverMotionIcon';
import { Check, ChevronLeft, Edit3, Mail, Phone, Sparkles } from 'lucide-react-native';
import {
  DRIVER_BTN_RADIUS,
  DRIVER_CARD_RADIUS,
  DRIVER_ROW_HEIGHT,
  DRIVER_SECTION_GAP,
  driverCardElevation,
} from '@/constants/DriverUi';
import Theme from '@/constants/Theme';
import Layout from '@/constants/Layout';
import Typography from '@/constants/Typography';
import { getAvatarUriForSeed, ALL_PRESET_AVATARS, DEFAULT_DRIVER_AVATAR_SEED, getPresetImageSourceForSeed } from '@/constants/DriverLevels';
import {
  DEFAULT_USER_2D_AVATAR_SEED,
  FEMALE_USER_2D_AVATARS,
  MALE_USER_2D_AVATARS,
  getUser2DAvatarUriForSeed,
  getUser2DPresetImageSourceForSeed,
} from '@/constants/UserAvatars';
import { useAuth } from '@/contexts/AuthContext';
import { pickAndUploadAvatar, getSignedAvatarUrl } from '@/lib/avatarUpload';
import { formatMobileNumber } from '@/lib/format';
import { validatePhone } from '@/lib/phoneValidation';
import { VALIDATION, maxLength, validateFullName } from '@/lib/validation';
import * as authService from '../services/auth.service';

const DEFAULT_AVATAR_SEED = DEFAULT_DRIVER_AVATAR_SEED;

/** Driver edit screen — gray canvas so the white cards lift off the page. */
const DRIVER_EDIT_PAGE_BG = Theme.surfaceGray;
/** Accent for photo actions — AgriFlow driver green. */
const DRIVER_FOREST = Theme.driverPrimary;
const DRIVER_INPUT_BG = Theme.liquidPillBg;
const DRIVER_AVATAR_SIZE = 80;
const DRIVER_EDIT_FAB = 28;
const DRIVER_CARD_ELEVATION = Platform.select({
  ios: {
    shadowColor: Theme.textPrimaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  },
  android: { elevation: 4 },
  web: {
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 32px rgba(15, 23, 42, 0.08)',
  },
  default: {},
});

export interface EditProfileModalProps {
  visible: boolean;
  onClose: () => void;
  /** Current profile values (from useAuth().profile / user) */
  initialFullName: string;
  initialPhone: string;
  initialCompanyName: string;
  /** Read-only; shown for context */
  email: string;
  /** Called after profile photo is updated so parent can refresh (e.g. refreshSession). */
  onPhotoUpdated?: (payload?: {
    avatarUri?: string | null;
    avatarPath?: string | null;
  }) => void | Promise<void>;
  /** Current preset seed when no uploaded photo (driver: from useDriverAvatar; tabs: from AsyncStorage). */
  initialAvatarSeed?: string;
  /** When user selects a preset from the grid, call this so parent can persist (e.g. setAvatarSeed or AsyncStorage). */
  onPresetSelected?: (seed: string) => void;
  /** Profile quote/status (WhatsApp-style). Shown in Edit when provided (e.g. driver profile). */
  initialStatusText?: string;
  /** Controls which preset avatars to show when choosing an avatar. */
  avatarPresetStyle?: 'driver' | 'user-2d';
  /**
   * Optional line under the name on the driver hero (e.g. tier). When omitted, a generic "DRIVER" label is shown.
   */
  heroSubtitle?: string;
  /**
   * `driver` — full-screen hero edit (avatar sheet + user-2d grid, editable phone/company).
   * `form` — compact form used by business/workspace profile.
   */
  layout?: 'driver' | 'form';
}

export function EditProfileModal({
  visible,
  onClose,
  initialFullName,
  initialPhone,
  initialCompanyName,
  email,
  onPhotoUpdated,
  initialAvatarSeed = DEFAULT_AVATAR_SEED,
  onPresetSelected,
  initialStatusText = '',
  avatarPresetStyle = 'driver',
  heroSubtitle,
  layout = 'form',
}: EditProfileModalProps) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const driverRefLayout = layout === 'driver';

  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState(initialPhone);
  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [statusText, setStatusText] = useState(initialStatusText);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const defaultPresetSeed =
    avatarPresetStyle === 'user-2d' ? DEFAULT_USER_2D_AVATAR_SEED : DEFAULT_AVATAR_SEED;
  const [avatarUri, setAvatarUri] = useState<string>(() =>
    (avatarPresetStyle === 'user-2d'
      ? getUser2DAvatarUriForSeed(defaultPresetSeed)
      : getAvatarUriForSeed(defaultPresetSeed)) ?? ''
  );
  const [selectedPresetSeed, setSelectedPresetSeed] = useState<string>(initialAvatarSeed);
  const [showAvatarDropdown, setShowAvatarDropdown] = useState(false);
  const [showAvatarActions, setShowAvatarActions] = useState(false);

  const heroRoleLine = (heroSubtitle?.trim() || 'DRIVER').toUpperCase();
  const emailTrimmed = email?.trim() ?? '';
  const hasEmail = emailTrimmed.length > 0;

  useEffect(() => {
    if (visible) {
      setFullName(initialFullName);
      setPhone(initialPhone);
      setCompanyName(initialCompanyName);
      setStatusText(initialStatusText);
      setError(null);
      setSelectedPresetSeed(initialAvatarSeed);
      setShowAvatarDropdown(false);
      setShowAvatarActions(false);
    }
  }, [visible, initialFullName, initialPhone, initialCompanyName, initialStatusText, initialAvatarSeed]);

  const getPresetUri = useCallback(
    (seed: string) => {
      return avatarPresetStyle === 'user-2d'
        ? getUser2DAvatarUriForSeed(seed)
        : getAvatarUriForSeed(seed);
    },
    [avatarPresetStyle]
  );

  const usesUploadedAvatar = Boolean(profile?.avatar_url?.trim());
  const avatarPreviewSource = useMemo(() => {
    if (usesUploadedAvatar && avatarUri.trim()) {
      return { uri: avatarUri };
    }
    const preset = avatarPresetStyle === 'user-2d'
      ? getUser2DPresetImageSourceForSeed(selectedPresetSeed)
      : getPresetImageSourceForSeed(selectedPresetSeed);
    return preset ?? { uri: '' };
  }, [usesUploadedAvatar, avatarUri, avatarPresetStyle, selectedPresetSeed]);

  /** Resolve display URI: uploaded (signed URL) or preset avatar. */
  const resolveAvatarUri = useCallback(
    async (avatarUrl: string | undefined, presetSeed: string) => {
      if (!avatarUrl?.trim()) {
        setAvatarUri(getPresetUri(presetSeed) ?? '');
        return;
      }
      if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
        setAvatarUri(avatarUrl);
        return;
      }
      const signed = await getSignedAvatarUrl(avatarUrl.trim());
      setAvatarUri(signed ?? getPresetUri(presetSeed) ?? '');
    },
    [getPresetUri]
  );

  useEffect(() => {
    if (!visible) return;
    resolveAvatarUri(profile?.avatar_url, selectedPresetSeed);
  }, [visible, profile?.avatar_url, selectedPresetSeed, resolveAvatarUri]);

  const handleSave = async () => {
    setError(null);
    const nameErr = validateFullName(true)(fullName);
    if (nameErr) {
      setError(nameErr);
      return;
    }
    const statusErr = maxLength(
      VALIDATION.STATUS_TEXT_MAX_LENGTH,
      'Status must be at most ' + VALIDATION.STATUS_TEXT_MAX_LENGTH + ' characters.'
    )(statusText.trim());
    if (statusErr) {
      setError(statusErr);
      return;
    }
    if (phone.trim()) {
      const phoneErr = validatePhone(phone);
      if (phoneErr) {
        setError(phoneErr);
        return;
      }
    }
    const name = fullName.trim();
    setSaving(true);
    const { error: err } = await authService.updateProfile({
      full_name: name,
      status_text: statusText.trim() || null,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(driverRefLayout ? { company_name: companyName.trim() } : {}),
    });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    await onPhotoUpdated?.();
    onClose();
  };

  const handleChangePhoto = async () => {
    const uid = profile?.uid;
    if (!uid) return;
    setShowAvatarActions(false);
    setError(null);
    setPhotoUploading(true);
    const { path, previewUri, error: pickErr } = await pickAndUploadAvatar(uid);
    setPhotoUploading(false);
    if (pickErr) {
      setError(pickErr.message);
      return;
    }
    if (!path) return; // user cancelled
    const { error: updateErr } = await authService.updateProfile({ avatar_url: path });
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    if (previewUri?.trim()) {
      setAvatarUri(previewUri);
    }
    const signed = await getSignedAvatarUrl(path);
    if (signed) {
      setAvatarUri(signed);
    }
    await onPhotoUpdated?.({
      avatarUri: signed ?? previewUri ?? null,
      avatarPath: path,
    });
  };

  const handleSelectPreset = async (seed: string) => {
    setShowAvatarDropdown(false);
    setError(null);
    const { error: updateErr } = await authService.updateProfile({
      avatar_url: null,
      avatar_seed: seed,
    } as authService.UpdateProfileOptions);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    setSelectedPresetSeed(seed);
    setAvatarUri(getPresetUri(seed) ?? '');
    onPresetSelected?.(seed);
    await onPhotoUpdated?.({
      avatarUri: getPresetUri(seed),
      avatarPath: null,
    });
  };

  const handleRemovePhoto = async () => {
    setError(null);
    const { error: updateErr } = await authService.updateProfile({
      avatar_url: null,
      avatar_seed: initialAvatarSeed,
    } as authService.UpdateProfileOptions);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    setSelectedPresetSeed(initialAvatarSeed);
    setAvatarUri(getPresetUri(initialAvatarSeed) ?? '');
    await onPhotoUpdated?.({
      avatarUri: getPresetUri(initialAvatarSeed),
      avatarPath: null,
    });
  };

  const openAvatarActions = () => {
    if (saving || photoUploading) return;
    setShowAvatarActions(true);
  };

  const onChooseAvatarFromSheet = () => {
    setShowAvatarActions(false);
    setShowAvatarDropdown(true);
  };

  const onUploadFromSheet = () => {
    setShowAvatarActions(false);
    void handleChangePhoto();
  };

  const handleDeactivateRequest = () => {
    Alert.alert(
      'Request account deactivation',
      'Your request will be reviewed by your fleet administrator. They will contact you if further action is needed.',
      [{ text: 'OK' }]
    );
  };

  /** One-tap random bio for driver edit (reference UI — Sparkles Generate). */
  const driverOneTapBios = useMemo(() => {
    const name = fullName.trim() || 'Driver';
    const comp = companyName.trim();
    const lines = [
      `Professional long-haul specialist — safety-first deliveries and clear updates on every trip.`,
      `Reliable fleet driver committed to punctual pickups and secure cargo handling${comp ? `, supporting ${comp}` : ''}.`,
      `${name}: disciplined routes, proactive communication, and professional handovers you can trust.`,
      `Experienced transport pilot focused on route efficiency, documentation discipline, and on-time fulfillment.`,
      `Detail-oriented operations — careful loading, steady transit, and dependable delivery execution.`,
    ];
    return lines.map((s) => s.slice(0, VALIDATION.STATUS_TEXT_MAX_LENGTH));
  }, [companyName, fullName]);

  const phoneVerified = useMemo(() => {
    const t = phone.trim();
    if (!t) return false;
    return validatePhone(t) === null;
  }, [phone]);

  const handleGenerateBioTap = useCallback(() => {
    if (!driverRefLayout) return;
    const list = driverOneTapBios;
    const pick =
      list.length > 0 ? list[Math.floor(Math.random() * list.length)]! : '';
    setStatusText(pick);
  }, [driverOneTapBios, driverRefLayout]);

  const showEmailOnboardingHint = () => {
    Alert.alert(
      'Add email to your account',
      'Email is set when you sign in with email, or your fleet administrator can link one. If you use phone sign-in only, ask your administrator to add an email to your profile.',
      [{ text: 'OK' }]
    );
  };

  const inputStyle = [
    styles.input,
    styles.inputThemed,
    { borderColor: Theme.borderInput, backgroundColor: Theme.surfaceForm, color: Theme.textPrimary },
  ];
  const labelStyle = [styles.label, { color: Theme.textMuted }];

  const renderAvatarGrid = () => (
    <View style={styles.dropdownWrap}>
      <ScrollView
        style={styles.dropdownList}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {avatarPresetStyle === 'user-2d' ? (
          <>
            <Text style={styles.avatarGroupTitle}>Male avatars</Text>
            <View style={styles.avatarGrid}>
              {MALE_USER_2D_AVATARS.map((av) => {
                const isSelected = selectedPresetSeed === av.seed;
                return (
                  <View key={av.seed} style={styles.avatarGridCell}>
                    <TouchableOpacity
                      style={[styles.avatarGridItem, isSelected && styles.avatarGridItemSelected]}
                      onPress={() => handleSelectPreset(av.seed)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={av.name ?? 'Avatar'}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Image source={av.image as never} style={styles.avatarGridAvatar} />
                      {isSelected ? (
                        <View style={styles.avatarGridCheck}>
                          <FontAwesome name="check" size={12} color={Theme.textOnPrimary} />
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
            <Text style={[styles.avatarGroupTitle, styles.avatarGroupTitleWithGap]}>Female avatars</Text>
            <View style={styles.avatarGrid}>
              {FEMALE_USER_2D_AVATARS.map((av) => {
                const isSelected = selectedPresetSeed === av.seed;
                return (
                  <View key={av.seed} style={styles.avatarGridCell}>
                    <TouchableOpacity
                      style={[styles.avatarGridItem, isSelected && styles.avatarGridItemSelected]}
                      onPress={() => handleSelectPreset(av.seed)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={av.name ?? 'Avatar'}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Image source={av.image as never} style={styles.avatarGridAvatar} />
                      {isSelected ? (
                        <View style={styles.avatarGridCheck}>
                          <FontAwesome name="check" size={12} color={Theme.textOnPrimary} />
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.avatarGrid}>
            {ALL_PRESET_AVATARS.map((av) => {
              const seed = (av as { seed: string }).seed;
              const name = (av as { name?: string }).name ?? 'Avatar';
              const isSelected = selectedPresetSeed === seed;
              const imageSource = (av as (typeof ALL_PRESET_AVATARS)[number]).image;
              return (
                <View key={seed} style={styles.avatarGridCell}>
                  <TouchableOpacity
                    style={[styles.avatarGridItem, isSelected && styles.avatarGridItemSelected]}
                    onPress={() => handleSelectPreset(seed)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={name}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Image source={imageSource as never} style={styles.avatarGridAvatar} resizeMode="contain" />
                    {isSelected ? (
                      <View style={styles.avatarGridCheck}>
                        <FontAwesome name="check" size={12} color={Theme.textOnPrimary} />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        if (showAvatarActions) {
          setShowAvatarActions(false);
          return;
        }
        if (showAvatarDropdown) {
          setShowAvatarDropdown(false);
          return;
        }
        onClose();
      }}
    >
      <KeyboardAvoidingView
        style={[styles.outer, driverRefLayout && { backgroundColor: DRIVER_EDIT_PAGE_BG }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={0}
      >
        {driverRefLayout ? (
          <View
            style={[
              styles.driverHeaderBar,
              {
                paddingTop: insets.top + 8,
                paddingBottom: 12,
              },
            ]}
          >
            <View style={styles.driverHeaderSide}>
              <TouchableOpacity
                onPress={onClose}
                style={styles.driverHeaderBackRound}
                hitSlop={12}
                accessibilityLabel="Go back"
                disabled={saving}
              >
                <ChevronLeft size={22} color={Theme.textPrimaryDark} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
            <Text style={styles.driverHeaderTitleCenter}>EDIT PROFILE</Text>
            <View style={[styles.driverHeaderSide, styles.driverHeaderSideEnd]}>
              <TouchableOpacity
                style={styles.driverHeaderSavePill}
                onPress={handleSave}
                disabled={saving}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Save profile"
              >
                {saving ? (
                  <LoadingIndicator size="small" color={Theme.driverEmerald} />
                ) : (
                  <Text style={styles.driverHeaderSavePillText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.header,
              { paddingTop: insets.top + Layout.driverHeaderTopOffset },
              {
                backgroundColor: Theme.darkBackground,
                borderBottomColor: Theme.borderOnDark,
              },
            ]}
          >
            <TouchableOpacity
              onPress={onClose}
              style={[styles.headerBtn, { backgroundColor: 'transparent' }]}
              hitSlop={12}
              accessibilityLabel="Close"
              disabled={saving}
            >
              <FontAwesome name="times" size={20} color={Theme.textOnDark} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: Theme.textOnDark }]}>Edit profile</Text>
            <View style={styles.headerSpacer} />
          </View>
        )}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            driverRefLayout ? styles.scrollContentDriver : styles.scrollContent,
            driverRefLayout && {
              paddingBottom: insets.bottom + Layout.keyboardAvoidScrollPadding,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {driverRefLayout ? (
            <>
              <View style={styles.driverHeroCard}>
                <View style={styles.driverAvatarRelative}>
                  <TouchableOpacity
                    activeOpacity={0.92}
                    onPress={openAvatarActions}
                    disabled={saving || photoUploading}
                    accessibilityLabel="Change profile photo"
                    accessibilityRole="button"
                  >
                    <View style={styles.driverAvatarRing}>
                      <View style={styles.driverSquircleInner}>
                        <Image source={avatarPreviewSource} style={styles.driverAvatarImageSq} resizeMode="cover" />
                        {photoUploading ? (
                          <View style={styles.driverAvatarLoading}>
                            <LoadingIndicator color={Theme.textOnPrimary} size="large" />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.driverEditFab}
                    onPress={openAvatarActions}
                    disabled={saving || photoUploading}
                    activeOpacity={0.85}
                    accessibilityLabel="Edit profile photo"
                    accessibilityRole="button"
                  >
                    <DriverMotionIcon>
                      <Edit3 size={13} color={Theme.textOnPrimary} strokeWidth={2.5} />
                    </DriverMotionIcon>
                  </TouchableOpacity>
                </View>
                <Text style={styles.driverHeroNameNew} numberOfLines={2}>
                  {fullName.trim() || 'Your name'}
                </Text>
                <View style={styles.driverStatusPill}>
                  <Text style={styles.driverHeroEyebrowSmall}>Driver profile · {heroRoleLine}</Text>
                </View>
                <View style={styles.driverCardDivider} />
                <View style={styles.driverHeroFields}>
                  <Text style={styles.driverCardSectionTitle}>Personal information</Text>
                  <Text style={styles.driverCardMicroLabel}>Full name</Text>
                  <TextInput
                    style={styles.driverCardTextInput}
                    placeholder="Enter your name"
                    placeholderTextColor={Theme.textMuted}
                    value={fullName}
                    onChangeText={setFullName}
                    autoCapitalize="words"
                    autoCorrect={false}
                    spellCheck={false}
                    autoComplete="off"
                    editable={!saving}
                    underlineColorAndroid="transparent"
                  />
                </View>
              </View>

              {showAvatarDropdown ? (
                <View style={styles.driverAvatarPickerBlock}>
                  <View style={styles.driverAvatarPickerHeader}>
                    <Text style={styles.driverAvatarPickerTitle}>Choose avatar</Text>
                    <TouchableOpacity
                      onPress={() => setShowAvatarDropdown(false)}
                      hitSlop={12}
                      accessibilityLabel="Close avatar picker"
                    >
                      <Text style={styles.driverAvatarPickerDone}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  {renderAvatarGrid()}
                </View>
              ) : null}

              {profile?.avatar_url ? (
                <TouchableOpacity
                  style={[styles.photoRow, styles.photoRowRemove, { marginBottom: 20 }]}
                  onPress={handleRemovePhoto}
                  disabled={saving || photoUploading}
                  activeOpacity={0.7}
                  accessibilityLabel="Remove profile photo"
                >
                  <FontAwesome name="trash-o" size={18} color={Theme.textSecondary} style={styles.photoIcon} />
                  <Text style={[styles.photoLabel, { color: Theme.textSecondary }]}>Remove photo</Text>
                </TouchableOpacity>
              ) : null}

              <View style={styles.driverCardWhiteBio}>
                <View style={styles.driverBioHeaderRow}>
                  <Text style={[styles.driverCardSectionTitle, styles.driverCardSectionTitleInline]}>Bio / status</Text>
                  <TouchableOpacity
                    style={styles.driverGeneratePill}
                    onPress={handleGenerateBioTap}
                    activeOpacity={0.85}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel="Generate bio"
                  >
                    <DriverMotionIcon>
                      <Sparkles size={12} color={Theme.driverEmerald} strokeWidth={2.4} />
                    </DriverMotionIcon>
                    <Text style={styles.driverGeneratePillText}>Generate</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.driverBioTextarea}
                  placeholder="e.g. Trust your feelings, be a good human being"
                  placeholderTextColor={Theme.textMuted}
                  value={statusText}
                  onChangeText={setStatusText}
                  multiline
                  maxLength={VALIDATION.STATUS_TEXT_MAX_LENGTH}
                  autoCorrect
                  spellCheck
                  editable={!saving}
                  textAlignVertical="top"
                  underlineColorAndroid="transparent"
                />
                <Text style={styles.driverBioHintItalic}>
                  Visible to passengers and fleet managers
                </Text>
              </View>

              <View style={styles.driverContactCard}>
                <Text style={styles.driverCardSectionTitle}>Contact details</Text>
                <TouchableOpacity
                  style={[styles.driverContactRow, styles.driverContactRowBorder]}
                  onPress={showEmailOnboardingHint}
                  activeOpacity={hasEmail ? 1 : 0.85}
                  disabled={Boolean(hasEmail)}
                  accessibilityRole="button"
                  accessibilityLabel={hasEmail ? 'Email address (read-only)' : 'Add email'}
                >
                  <DriverIconWell backgroundColor={Theme.driverEmeraldMuted} borderColor={Theme.driverEmeraldBorderSoft} motionDelay={0}>
                    <Mail size={driverIconSize} color={Theme.driverEmerald} strokeWidth={2.2} />
                  </DriverIconWell>
                  <View style={styles.driverContactMid}>
                    <Text style={styles.driverContactEyebrow}>Email address</Text>
                    <Text style={styles.driverContactValue} numberOfLines={2}>
                      {hasEmail ? emailTrimmed : 'Add email'}
                    </Text>
                  </View>
                  {hasEmail ? (
                    <FontAwesome name="chevron-right" size={14} color={Theme.textMuted} />
                  ) : (
                    <FontAwesome name="chevron-right" size={14} color={Theme.textMuted} />
                  )}
                </TouchableOpacity>

                <View style={styles.driverContactRow}>
                  <DriverIconWell
                    backgroundColor={Theme.brandBlueSoft}
                    borderColor={Theme.brandBlueRing}
                    motionDelay={120}
                  >
                    <Phone size={driverIconSize} color={Theme.assignmentVehicleAccent} strokeWidth={2.2} />
                  </DriverIconWell>
                  <View style={styles.driverContactMid}>
                    <Text style={styles.driverContactEyebrow}>Mobile number</Text>
                    <TextInput
                      style={styles.driverContactPhoneInput}
                      placeholder="+91 98765 43210"
                      placeholderTextColor={Theme.textMuted}
                      value={phone}
                      onChangeText={(v) => setPhone(formatMobileNumber(v))}
                      keyboardType="phone-pad"
                      autoCorrect={false}
                      spellCheck={false}
                      autoComplete="off"
                      editable={!saving}
                      underlineColorAndroid="transparent"
                    />
                  </View>
                  {phoneVerified ? (
                    <View style={styles.driverVerifiedChip}>
                      <DriverMotionIcon>
                        <Check size={12} color={Theme.driverEmerald} strokeWidth={3} />
                      </DriverMotionIcon>
                      <Text style={styles.driverVerifiedChipText}>Verified</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={styles.driverCardWhite}>
                <Text style={styles.driverCardSectionTitle}>Fleet / account</Text>
                <Text style={styles.driverCardMicroLabel}>Registered company name</Text>
                <TextInput
                  style={styles.driverCardTextInput}
                  placeholder="Company name"
                  placeholderTextColor={Theme.textMuted}
                  value={companyName}
                  onChangeText={setCompanyName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="off"
                  editable={!saving}
                  underlineColorAndroid="transparent"
                />
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.driverSaveChangesBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.9}
                accessibilityLabel="Save changes"
              >
                {saving ? (
                  <LoadingIndicator size="small" color={Theme.textOnPrimary} />
                ) : (
                  <Text style={styles.driverSaveChangesBtnText}>UPDATE PROFILE INFORMATION</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.driverDeactivateBtn}
                onPress={handleDeactivateRequest}
                activeOpacity={0.75}
                accessibilityLabel="Request account deactivation"
                accessibilityRole="button"
              >
                <Text style={styles.driverDeactivateBtnText}>Request Account Deactivation</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.avatarSection}>
                <Text style={[styles.sectionLabel, { color: Theme.textMuted }]}>
                  Change profile photo
                </Text>
                <View style={styles.avatarActionWrap}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={openAvatarActions}
                    disabled={saving || photoUploading}
                    accessibilityLabel="Change profile photo"
                    accessibilityRole="button"
                  >
                    <View
                      style={[
                        styles.avatarPreviewWrap,
                        styles.avatarRingGreen,
                        {
                          backgroundColor: Theme.surfaceGray,
                          borderColor: Theme.primary,
                        },
                      ]}
                    >
                      <Image source={avatarPreviewSource} style={styles.avatarPreview} resizeMode="cover" />
                      {photoUploading ? (
                        <View style={styles.avatarPreviewLoading}>
                          <LoadingIndicator size="small" color={Theme.textOnPrimary} />
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.avatarQuickEditBtn}
                    onPress={openAvatarActions}
                    disabled={saving || photoUploading}
                    activeOpacity={0.85}
                    accessibilityLabel="Edit profile photo"
                    accessibilityRole="button"
                  >
                    <Edit3 size={14} color={Theme.buttonPrimaryText} strokeWidth={2.4} />
                  </TouchableOpacity>
                </View>

                {showAvatarDropdown ? renderAvatarGrid() : null}

                {profile?.avatar_url ? (
                  <TouchableOpacity
                    style={[styles.photoRow, styles.photoRowRemove, { marginTop: 10 }]}
                    onPress={handleRemovePhoto}
                    disabled={saving || photoUploading}
                    activeOpacity={0.7}
                    accessibilityLabel="Remove profile photo"
                  >
                    <FontAwesome name="trash-o" size={18} color={Theme.textSecondary} style={styles.photoIcon} />
                    <Text style={[styles.photoLabel, { color: Theme.textSecondary }]}>Remove photo</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <Text style={labelStyle}>Full name</Text>
              <TextInput
                style={inputStyle}
                placeholder="Your name"
                placeholderTextColor={Theme.textMuted}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                editable={!saving}
              />

              <Text style={labelStyle}>Email address</Text>
              <TextInput
                style={[inputStyle, styles.inputReadOnly]}
                value={email}
                editable={false}
                placeholder="—"
                placeholderTextColor={Theme.textMuted}
              />
              <Text style={styles.hint}>Email cannot be changed here.</Text>

              <Text style={labelStyle}>Mobile number</Text>
              <TextInput
                style={inputStyle}
                value={phone}
                onChangeText={(v) => setPhone(formatMobileNumber(v))}
                editable={!saving}
                placeholder="98765 43210"
                placeholderTextColor={Theme.textMuted}
                keyboardType="phone-pad"
                inputMode="tel"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="tel"
                textContentType="telephoneNumber"
                accessibilityLabel="Mobile number"
              />
              <Text style={styles.hint}>
                Add a 10-digit Indian mobile. Used for team invites and partner connections.
              </Text>

              <Text style={labelStyle}>Registered company</Text>
              <TextInput
                style={[inputStyle, styles.inputReadOnly]}
                value={companyName}
                editable={false}
                placeholder="—"
                placeholderTextColor={Theme.textMuted}
              />
              <Text style={styles.hint}>Registered at signup. Contact support to update.</Text>

              <Text style={labelStyle}>Status / Quote</Text>
              <TextInput
                style={[inputStyle, { minHeight: 64 }]}
                placeholder="e.g. Trust your feelings, be a good human being"
                placeholderTextColor={Theme.textMuted}
                value={statusText}
                onChangeText={setStatusText}
                multiline
                numberOfLines={2}
                maxLength={VALIDATION.STATUS_TEXT_MAX_LENGTH}
                autoCorrect
                spellCheck
                editable={!saving}
              />
              <Text style={styles.hint}>
                Shown under your name on profile ({statusText.length}/{VALIDATION.STATUS_TEXT_MAX_LENGTH}).
              </Text>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Text style={styles.storageNote}>Saved to your account (Supabase Auth).</Text>
            </>
          )}
        </ScrollView>

        {!driverRefLayout ? (
          <View
            style={[
              styles.footer,
              { backgroundColor: Theme.screenBackground, borderTopColor: Theme.borderLight },
              { paddingBottom: insets.bottom + 16 },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.saveBtn,
                { backgroundColor: Theme.darkBackground },
                saving && styles.saveBtnDisabled,
              ]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <LoadingIndicator size="small" color={Theme.textOnPrimary} />
              ) : (
                <Text style={styles.saveBtnText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {showAvatarActions ? (
          <View style={styles.actionSheetOverlay}>
            <Pressable
              style={styles.actionSheetBackdropFill}
              onPress={() => setShowAvatarActions(false)}
              accessibilityLabel="Dismiss"
            />
            <View
              style={[
                styles.actionSheetCard,
                { paddingBottom: Math.max(insets.bottom, 16) + 12 },
              ]}
            >
              <Text style={styles.actionSheetTitle}>Profile photo</Text>
              <TouchableOpacity
                style={styles.actionSheetRow}
                onPress={onChooseAvatarFromSheet}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Choose avatar"
              >
                <FontAwesome name="user" size={18} color={DRIVER_FOREST} style={styles.actionSheetIcon} />
                <Text style={styles.actionSheetRowLabel}>Choose Avatar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionSheetRow}
                onPress={onUploadFromSheet}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Upload photo"
                disabled={photoUploading}
              >
                <FontAwesome name="camera" size={18} color={DRIVER_FOREST} style={styles.actionSheetIcon} />
                <Text style={styles.actionSheetRowLabel}>Upload Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionSheetRow, styles.actionSheetRowLast]}
                onPress={() => setShowAvatarActions(false)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={[styles.actionSheetRowLabel, styles.actionSheetCancelText]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: Theme.screenBackground,
  },
  driverHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.screenPaddingHorizontal,
    backgroundColor: DRIVER_EDIT_PAGE_BG,
  },
  driverHeaderSide: {
    width: 88,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  driverHeaderSideEnd: {
    alignItems: 'flex-end',
  },
  driverHeaderBackRound: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    ...DRIVER_CARD_ELEVATION,
  },
  driverHeaderTitleCenter: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: Theme.textPrimaryDark,
  },
  driverHeaderSavePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
    minWidth: 72,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    ...DRIVER_CARD_ELEVATION,
  },
  driverHeaderSavePillText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: Theme.driverEmerald,
    textTransform: 'uppercase',
  },
  driverHeroCard: {
    alignItems: 'center',
    backgroundColor: Theme.cardWhite,
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 14,
    marginBottom: DRIVER_SECTION_GAP,
    ...driverCardElevation,
  },
  driverAvatarRelative: {
    position: 'relative',
    width: DRIVER_AVATAR_SIZE + 12,
    height: DRIVER_AVATAR_SIZE + 12,
    borderRadius: (DRIVER_AVATAR_SIZE + 12) / 2,
    backgroundColor: Theme.driverEmeraldMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  driverAvatarRing: {
    width: DRIVER_AVATAR_SIZE,
    height: DRIVER_AVATAR_SIZE,
    borderRadius: DRIVER_AVATAR_SIZE / 2,
    backgroundColor: Theme.cardWhite,
    borderWidth: 3,
    borderColor: Theme.cardWhite,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  driverSquircleInner: {
    flex: 1,
    borderRadius: DRIVER_AVATAR_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: Theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarImageSq: {
    width: '100%',
    height: '100%',
  },
  driverHeroNameNew: {
    fontSize: 20,
    fontWeight: '800',
    color: Theme.textPrimaryDark,
    letterSpacing: -0.3,
    textAlign: 'center',
    maxWidth: '100%',
  },
  driverStatusPill: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: Theme.driverEmeraldMuted,
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
    maxWidth: '100%',
  },
  driverHeroEyebrowSmall: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Theme.driverEmerald,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  driverCardDivider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.borderLight,
    marginTop: 12,
    marginBottom: 12,
  },
  driverHeroFields: {
    alignSelf: 'stretch',
  },
  driverCardSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: Theme.textPrimaryDark,
    marginBottom: 8,
  },
  driverCardSectionTitleInline: {
    flex: 1,
    marginBottom: 0,
  },
  driverCardWhite: {
    backgroundColor: Theme.cardWhite,
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: DRIVER_SECTION_GAP,
    ...driverCardElevation,
  },
  driverCardMicroLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.15,
    color: Theme.textRouteCard,
    marginBottom: 6,
  },
  driverCardTextInput: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.textPrimaryDark,
    backgroundColor: Theme.surface,
    borderRadius: DRIVER_BTN_RADIUS,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: DRIVER_ROW_HEIGHT - 4,
  },
  driverBioHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  driverGeneratePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Theme.driverEmeraldMuted,
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
  },
  driverGeneratePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: Theme.driverEmerald,
    textTransform: 'uppercase',
  },
  driverCardWhiteBio: {
    backgroundColor: Theme.cardWhite,
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    marginBottom: DRIVER_SECTION_GAP,
    ...driverCardElevation,
  },
  driverBioTextarea: {
    fontSize: 14,
    fontWeight: '500',
    color: Theme.textPrimary,
    backgroundColor: Theme.surface,
    borderRadius: DRIVER_BTN_RADIUS,
    borderWidth: 1,
    borderColor: Theme.borderLight,
    minHeight: 72,
    lineHeight: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  driverBioHintItalic: {
    fontSize: 11,
    fontStyle: 'italic',
    fontWeight: '500',
    color: Theme.textMuted,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.borderLight,
  },
  driverContactCard: {
    backgroundColor: Theme.cardWhite,
    borderRadius: DRIVER_CARD_RADIUS,
    borderWidth: 1,
    borderColor: Theme.driverSecondaryGrey,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
    marginBottom: DRIVER_SECTION_GAP,
    ...driverCardElevation,
  },
  driverContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    minHeight: DRIVER_ROW_HEIGHT + 4,
  },
  driverContactRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderLight,
  },
  driverContactMid: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  driverContactEyebrow: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
    color: Theme.textRouteCard,
    marginBottom: 2,
  },
  driverContactValue: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.textPrimaryDark,
  },
  driverContactPhoneInput: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.textPrimaryDark,
    paddingVertical: 0,
    paddingHorizontal: 0,
    minHeight: 22,
  },
  driverVerifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Theme.driverEmeraldMuted,
    borderWidth: 1,
    borderColor: Theme.driverEmeraldBorderSoft,
  },
  driverVerifiedChipText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: Theme.driverEmerald,
    textTransform: 'uppercase',
  },
  driverAvatarLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverEditFab: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: DRIVER_EDIT_FAB,
    height: DRIVER_EDIT_FAB,
    borderRadius: DRIVER_EDIT_FAB / 2,
    borderWidth: 2,
    borderColor: Theme.cardWhite,
    backgroundColor: DRIVER_FOREST,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
    }),
  },
  driverEditFabElevated: {
    right: 0,
    bottom: 0,
  },
  driverSectionLegend: {
    ...Typography.headerTitle,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: Theme.textSection,
    marginBottom: 12,
    marginTop: 4,
  },
  driverSectionLegendSpaced: {
    marginTop: Layout.sectionSpacing,
  },
  driverFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Theme.textPrimary,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  driverFieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  autoGenerateBioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginBottom: 8,
  },
  autoGenerateBioBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: DRIVER_FOREST,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bioSuggestionBlock: {
    marginBottom: 14,
  },
  bioSuggestionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  bioSuggestionCard: {
    backgroundColor: Theme.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  bioSuggestionCardSelected: {
    backgroundColor: Theme.positiveMuted,
  },
  bioSuggestionText: {
    fontSize: 13,
    lineHeight: 19,
    color: Theme.textPrimary,
    fontWeight: '500',
  },
  bioSuggestionTextSelected: {
    color: Theme.textPrimaryDark,
    fontWeight: '600',
  },
  bioSuggestionFooter: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bioSuggestionUseText: {
    fontSize: 11,
    fontWeight: '700',
    color: Theme.darkGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  driverInput: {
    backgroundColor: DRIVER_INPUT_BG,
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 16,
    fontWeight: '400',
    color: Theme.textPrimaryDark,
    marginBottom: 20,
  },
  driverInputMultiline: {
    minHeight: 100,
    paddingTop: 16,
  },
  driverInputReadonly: {
    backgroundColor: Theme.surfaceBorder,
    color: Theme.textSecondary,
  },
  driverBioHint: {
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '400',
    color: Theme.textMuted,
    textAlign: 'right',
    marginTop: 8,
    marginBottom: 20,
    paddingHorizontal: 4,
    lineHeight: 16,
  },
  driverEmailShell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.surfaceBorder,
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 52,
    marginBottom: 0,
  },
  driverEmailReadonlyText: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '400',
    color: Theme.textSecondary,
    marginRight: 10,
  },
  driverEmailEmptyCard: {
    backgroundColor: DRIVER_INPUT_BG,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 0,
  },
  driverEmailEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  driverEmailEmptyCta: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Theme.textPrimaryDark,
  },
  driverEmailEmptySub: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '400',
    color: Theme.textMuted,
    lineHeight: 16,
  },
  driverEmailAdminHint: {
    fontSize: 12,
    fontWeight: '400',
    color: Theme.textMuted,
    marginTop: 8,
    marginBottom: 20,
    paddingHorizontal: 2,
    lineHeight: 17,
  },
  driverPhoneRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    marginTop: 0,
  },
  driverPhonePrefix: {
    width: 88,
    backgroundColor: DRIVER_INPUT_BG,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  driverPhonePrefixText: {
    fontSize: 16,
    fontWeight: '600',
    color: Theme.textPrimaryDark,
  },
  driverPhoneInput: {
    flex: 1,
    marginBottom: 20,
  },
  driverSaveChangesBtn: {
    marginTop: 4,
    backgroundColor: Theme.driverPrimary,
    borderRadius: DRIVER_BTN_RADIUS,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: DRIVER_ROW_HEIGHT + 4,
    ...Platform.select({
      ios: {
        shadowColor: DRIVER_FOREST,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
      },
      android: { elevation: 6 },
    }),
  },
  driverSaveChangesBtnText: {
    fontSize: 11,
    fontWeight: '900',
    color: Theme.buttonPrimaryText,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  driverDeactivateBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  driverDeactivateBtnText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: Theme.negative,
    textTransform: 'uppercase',
  },
  driverAvatarPickerBlock: {
    marginBottom: 20,
  },
  driverAvatarPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  driverAvatarPickerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Theme.textPrimaryDark,
  },
  driverAvatarPickerDone: {
    fontSize: 15,
    fontWeight: '600',
    color: DRIVER_FOREST,
  },
  scrollContentDriver: {
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 12,
  },
  actionSheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 100,
    ...Platform.select({ android: { elevation: 24 } }),
  },
  actionSheetBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.overlayBackdrop,
    zIndex: 0,
  },
  actionSheetCard: {
    backgroundColor: Theme.screenBackground,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
    ...Platform.select({ android: { elevation: 28 }, web: { position: 'relative' as const } }),
  },
  actionSheetTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  actionSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderLight,
  },
  actionSheetRowLast: {
    borderBottomWidth: 0,
    marginTop: 4,
  },
  actionSheetIcon: {
    marginRight: 14,
    width: 24,
  },
  actionSheetRowLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: Theme.textPrimaryDark,
  },
  actionSheetCancelText: {
    textAlign: 'center',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingBottom: Layout.spacingMedium,
    borderBottomWidth: 1,
    borderBottomColor: Theme.borderLight,
  },
  headerThemed: {
    borderBottomColor: Theme.positiveMuted,
    backgroundColor: Theme.screenBackground,
  },
  headerBtn: {
    width: 44,
    height: 44,
    backgroundColor: Theme.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Theme.textPrimaryDark,
    textAlign: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 20,
    paddingBottom: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 8,
    color: Theme.textMuted,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 18,
    minHeight: 48,
  },
  inputThemed: {
  },
  inputReadOnly: {
    backgroundColor: Theme.surfaceBorder,
    color: Theme.textSecondary,
  },
  hint: {
    fontSize: 11,
    color: Theme.textMuted,
    marginTop: -8,
    marginBottom: 16,
  },
  avatarSection: {
    marginBottom: 20,
    alignItems: 'stretch',
  },
  avatarActionWrap: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    width: 96,
    height: 96,
    marginBottom: 14,
    position: 'relative',
  },
  avatarPreviewWrap: {
    alignItems: 'center',
    marginBottom: 0,
    position: 'relative',
  },
  changePhotoOptionsCard: {
    backgroundColor: Theme.screenBackground,
    overflow: 'hidden',
  },
  changePhotoOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  changePhotoOptionBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.borderLight,
  },
  changePhotoOptionAvatar: {
    width: 32,
    height: 32,
    marginRight: 12,
    backgroundColor: Theme.surface,
  },
  changePhotoOptionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: Theme.textPrimaryDark,
  },
  avatarRingGreen: {
    padding: 4,
    alignSelf: 'center',
    backgroundColor: Theme.surfaceLight,
  },
  avatarPreview: {
    width: 88,
    height: 88,
    backgroundColor: Theme.surfaceLight,
  },
  avatarPreviewLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarQuickEditBtn: {
    position: 'absolute',
    right: -8,
    bottom: -4,
    width: 30,
    height: 30,
    backgroundColor: Theme.buttonPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Theme.surface,
  },
  photoRowRemove: {
    marginTop: 8,
    backgroundColor: Theme.surface,
  },
  dropdownWrap: {
    marginTop: 8,
  },
  avatarGroupTitle: {
    marginTop: 10,
    marginBottom: 2,
    marginHorizontal: 12,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  avatarGroupTitleWithGap: {
    marginTop: 4,
  },
  dropdownList: {
    marginTop: 6,
    backgroundColor: Theme.screenBackground,
    maxHeight: 280,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  avatarGridCell: {
    flexBasis: '16.6667%',
    padding: 5,
  },
  avatarGridItem: {
    width: '100%',
    aspectRatio: 1,
    borderWidth: 2,
    backgroundColor: Theme.surface,
    overflow: 'hidden',
  },
  avatarGridItemSelected: {
    borderColor: Theme.positive,
  },
  avatarGridAvatar: {
    width: '100%',
    height: '100%',
  },
  avatarGridCheck: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    backgroundColor: Theme.positive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoIcon: { marginRight: 14 },
  photoLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Theme.textPrimaryDark,
  },
  errorText: {
    fontSize: 13,
    color: Theme.negative,
    marginBottom: 12,
  },
  storageNote: {
    fontSize: 10,
    color: Theme.textMuted,
    marginTop: 8,
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  footer: {
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Theme.borderLight,
  },
  saveBtn: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.buttonPrimaryText,
  },
});
