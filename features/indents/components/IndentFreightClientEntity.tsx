import { memo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { Package } from "lucide-react-native";

import { PartyAvatar } from "@/components/PartyAvatar";
import Theme from "@/constants/Theme";
import { indentReviewHubText } from "@/features/indents/styles/indentReviewHubStyles";
import { useIndentClientEntityAvatar } from "@/features/indents/hooks/useIndentClientEntityAvatar";

const AVATAR_SIZE_LIGHT = 40;
const AVATAR_SIZE_DARK = 32;

export type IndentFreightClientEntityProps = {
  label?: string;
  displayName: string;
  /** Full name for avatar initials / photo resolution (defaults to `displayName`). */
  avatarName?: string;
  clientId?: string | null;
  ownerOrgId: string | null;
  shipperOrgId: string | null | undefined;
  isOwner: boolean;
  align?: "left" | "right";
  nameLines?: number;
  style?: StyleProp<ViewStyle>;
  /** `light` for white review-hub cards; `dark` for navy freight hero strips. */
  surface?: "light" | "dark";
  /** Hide the entity sub-label when the parent row already shows a section title. */
  hideLabel?: boolean;
  /** Override default avatar diameter (light cards default 40, dark 32). */
  avatarSize?: number;
  /** Hide contact/phone detail under the name. */
  hideDetail?: boolean;
  /**
   * Network pool detail: no avatar lookup, no contact line, no profile link.
   * Shows `displayName` (a neutral label) beside a plain load mark.
   */
  anonymous?: boolean;
};

export const IndentFreightClientEntity = memo(function IndentFreightClientEntity({
  label = "CLIENT ENTITY",
  displayName,
  avatarName,
  clientId,
  ownerOrgId,
  shipperOrgId,
  isOwner,
  align = "left",
  nameLines = 1,
  style,
  surface = "light",
  hideLabel = false,
  avatarSize,
  hideDetail = false,
  anonymous = false,
}: IndentFreightClientEntityProps) {
  const router = useRouter();
  const resolved = useIndentClientEntityAvatar({
    clientId: anonymous ? null : clientId,
    ownerOrgId,
    shipperOrgId: anonymous ? null : shipperOrgId,
    isOwner,
    enabled: !anonymous,
  });
  const fields = anonymous
    ? { ...resolved.fields, detailLine: null, isIntegrated: null }
    : resolved.fields;
  const canOpenPublicProfile = !anonymous && resolved.canOpenPublicProfile;
  const { publicProfileClientId, publicProfileTarget } = resolved;

  const isRight = align === "right";
  const onLight = surface === "light";
  const resolvedAvatarName = (avatarName ?? displayName).trim() || displayName;
  const resolvedAvatarSize =
    avatarSize ?? (onLight ? AVATAR_SIZE_LIGHT : AVATAR_SIZE_DARK);

  const openProfile = () => {
    if (!canOpenPublicProfile) return;
    if (isOwner && publicProfileClientId) {
      router.push(`/public-profile/client/${publicProfileClientId}`);
      return;
    }
    if (publicProfileTarget) {
      router.push(
        `/public-profile/${publicProfileTarget.type}/${publicProfileTarget.id}`,
      );
    }
  };

  const avatar = anonymous ? (
    <View
      style={[
        styles.anonymousMark,
        { width: resolvedAvatarSize, height: resolvedAvatarSize },
      ]}
      testID="indent-detail-anonymous-shipper"
    >
      <Package
        size={Math.round(resolvedAvatarSize * 0.45)}
        color={Theme.primary}
        strokeWidth={2.2}
      />
    </View>
  ) : (
    <PartyAvatar
      name={resolvedAvatarName}
      avatarUrl={fields.avatarUrl}
      avatarSeed={fields.avatarSeed}
      organizationImageUrl={fields.organizationImageUrl}
      organizationAvatarSeed={fields.organizationAvatarSeed}
      entityType="client"
      isIntegrated={
        fields.isIntegrated === null ? undefined : fields.isIntegrated
      }
      size={resolvedAvatarSize}
      initialsColorSeed={
        publicProfileClientId ?? shipperOrgId ?? resolvedAvatarName
      }
    />
  );

  const nameBlock = (
    <View style={styles.nameCopy}>
      <Text
        style={[
          onLight ? styles.nameLight : styles.nameDark,
          isRight && styles.nameRight,
        ]}
        numberOfLines={nameLines}
      >
        {displayName}
      </Text>
      {!hideDetail && fields.detailLine ? (
        <Text
          style={[
            styles.detailLine,
            !onLight && styles.detailLineDark,
            isRight && styles.nameRight,
          ]}
          numberOfLines={1}
        >
          {fields.detailLine}
        </Text>
      ) : fields.isIntegrated === true ? (
        <Text
          style={[
            styles.detailLine,
            styles.detailIntegrated,
            isRight && styles.nameRight,
          ]}
          numberOfLines={1}
        >
          Integrated
        </Text>
      ) : null}
    </View>
  );

  return (
    <View
      style={[
        styles.root,
        isRight && styles.rootRight,
        style,
      ]}
    >
      {!hideLabel ? (
        <Text
          style={[
            onLight ? styles.labelLight : styles.labelDark,
            isRight && styles.labelRight,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.nameRow,
          isRight ? styles.nameRowRight : styles.nameRowLeft,
          hideLabel && styles.nameRowNoLabel,
        ]}
      >
        {canOpenPublicProfile ? (
          <Pressable
            onPress={openProfile}
            style={({ pressed }) => [
              styles.avatarPress,
              { borderRadius: resolvedAvatarSize / 2 },
              pressed && styles.avatarPressPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`View public profile for ${displayName}`}
            hitSlop={6}
          >
            {avatar}
          </Pressable>
        ) : (
          <View style={[styles.avatarPress, { borderRadius: resolvedAvatarSize / 2 }]}>
            {avatar}
          </View>
        )}
        {canOpenPublicProfile ? (
          <Pressable
            onPress={openProfile}
            style={styles.namePress}
            accessibilityRole="button"
            accessibilityLabel={`View details for ${displayName}`}
          >
            {nameBlock}
          </Pressable>
        ) : (
          nameBlock
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
  },
  rootRight: {
    alignItems: "flex-end",
  },
  labelDark: {
    ...indentReviewHubText.freightGridLabelDark,
    marginBottom: 4,
  },
  labelLight: {
    ...indentReviewHubText.freightGridLabelLight,
    marginBottom: 4,
  },
  labelRight: {
    textAlign: "right",
  },
  nameRow: {
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    alignSelf: "stretch",
    width: "100%",
  },
  nameRowNoLabel: {
    marginTop: 0,
  },
  nameRowLeft: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  nameRowRight: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  avatarPress: {
    borderWidth: 1,
    borderColor: Theme.separatorDark,
    overflow: "hidden",
    flexShrink: 0,
  },
  anonymousMark: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.brandBlueSoft,
  },
  avatarPressPressed: {
    opacity: 0.88,
  },
  namePress: {
    flex: 1,
    minWidth: 0,
  },
  nameCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameDark: {
    ...indentReviewHubText.freightGridValueDark,
  },
  nameLight: {
    ...indentReviewHubText.freightGridValueLight,
  },
  nameRight: {
    textAlign: "right",
  },
  detailLine: {
    fontSize: 10,
    fontWeight: "400",
    color: Theme.textSecondary,
    lineHeight: 13,
  },
  detailLineDark: {
    color: Theme.textOnDarkMuted,
  },
  detailIntegrated: {
    color: Theme.positive,
    fontWeight: "600",
  },
});
