import { Theme } from "@/constants/Theme";
import { useAuth } from "@/contexts/AuthContext";
import {
  HARD_COPY_POD_PHOTO_TYPES,
  hardCopyPodPhotoRejectionMessage,
  isHardCopyPodPhoto,
  shortHardCopyPodPhotoName,
} from "@/features/trips/components/trip-detail/hardCopyPodPhotos.util";
import { VAULT_DOC_MAX_BYTES, VAULT_DOC_MAX_MB } from "@/features/trips/components/trip-detail/tripDocTypes";
import {
  deleteTripDocument,
  getDocumentsByTripId,
  getDocumentViewUrls,
  uploadTripDocument,
  type TripDocumentRow,
} from "@/features/trips/services/tripDocuments.service";
import { Upload, X } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type PodPhotoItem = {
  key: string;
  fileName: string;
  previewUri: string | null;
  document: TripDocumentRow | null;
  uploading: boolean;
};

async function readFileAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    return response.arrayBuffer();
  }
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: "base64" as const,
  });
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

function isPodImageDocument(doc: TripDocumentRow): boolean {
  if (doc.document_type !== "pod") return false;
  return isHardCopyPodPhoto({ name: doc.file_name, mimeType: doc.mime_type });
}

export function HardCopyPodPhotoUpload({
  tripId,
  canEdit,
}: {
  tripId: string;
  canEdit: boolean;
}) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<PodPhotoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PodPhotoItem | null>(null);
  const droppedRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      const { documents } = await getDocumentsByTripId(tripId, {
        includeOcr: false,
        includeStorageFallback: true,
      });
      if (cancelled) return;
      const images = documents.filter(isPodImageDocument).slice().reverse();
      const urls = await getDocumentViewUrls(images.map((doc) => doc.storage_path));
      if (cancelled) return;
      setPhotos((current) => {
        const saved: PodPhotoItem[] = images.map((doc) => ({
          key: doc.id,
          fileName: doc.file_name,
          previewUri: urls[doc.storage_path] ?? null,
          document: doc,
          uploading: false,
        }));
        const savedIds = new Set(saved.map((item) => item.key));
        const pending = current.filter(
          (item) => item.uploading || (item.document != null && !savedIds.has(item.document.id)),
        );
        return [...saved, ...pending.filter((item) => !savedIds.has(item.key))];
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const uploadOne = useCallback(
    async (key: string, uri: string, fileName: string, mimeType: string) => {
      const uploaderId = user?.uid;
      if (!uploaderId) {
        setPhotos((current) => current.filter((item) => item.key !== key));
        setValidationMessage("Sign in to upload POD photos.");
        return;
      }
      try {
        const arrayBuffer = await readFileAsArrayBuffer(uri);
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          setPhotos((current) => current.filter((item) => item.key !== key));
          setValidationMessage(`Could not read ${fileName}.`);
          return;
        }
        if (arrayBuffer.byteLength > VAULT_DOC_MAX_BYTES) {
          setPhotos((current) => current.filter((item) => item.key !== key));
          setValidationMessage(
            `${fileName} exceeds ${VAULT_DOC_MAX_MB} MB. Each photo must be ${VAULT_DOC_MAX_MB} MB or smaller.`,
          );
          return;
        }
        const { doc, error } = await uploadTripDocument(
          tripId,
          uploaderId,
          { arrayBuffer, fileName, mimeType },
          "pod",
        );
        if (droppedRef.current.has(key)) {
          if (doc) await deleteTripDocument(doc);
          return;
        }
        if (error || !doc) {
          setPhotos((current) => current.filter((item) => item.key !== key));
          setValidationMessage(error?.message || `Could not upload ${fileName}.`);
          return;
        }
        const signed = await getDocumentViewUrls([doc.storage_path]);
        setPhotos((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  key: doc.id,
                  fileName: doc.file_name || fileName,
                  previewUri: signed[doc.storage_path] || item.previewUri,
                  document: doc,
                  uploading: false,
                }
              : item,
          ),
        );
      } catch (err) {
        if (droppedRef.current.has(key)) return;
        setPhotos((current) => current.filter((item) => item.key !== key));
        setValidationMessage(err instanceof Error ? err.message : `Could not upload ${fileName}.`);
      }
    },
    [tripId, user?.uid],
  );

  const pickPhotos = useCallback(async () => {
    if (!canEdit) return;
    setValidationMessage(null);
    const res = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: [...HARD_COPY_POD_PHOTO_TYPES],
    });
    if (res.canceled || !res.assets?.length) return;

    const rejection = hardCopyPodPhotoRejectionMessage(res.assets);
    const accepted = res.assets.filter(
      (asset) =>
        isHardCopyPodPhoto(asset) &&
        !(typeof asset.size === "number" && asset.size > VAULT_DOC_MAX_BYTES),
    );
    if (rejection) setValidationMessage(rejection);
    if (accepted.length === 0) return;

    const batch = accepted.map((asset, index) => ({
      key: `local-${Date.now()}-${index}-${asset.name ?? "pod"}`,
      fileName: asset.name?.trim() || `pod-${index + 1}.jpg`,
      previewUri: asset.uri,
      mimeType: asset.mimeType || "image/jpeg",
      uri: asset.uri,
    }));

    setPhotos((current) => [
      ...current,
      ...batch.map((item) => ({
        key: item.key,
        fileName: item.fileName,
        previewUri: item.previewUri,
        document: null,
        uploading: true,
      })),
    ]);

    for (const item of batch) {
      void uploadOne(item.key, item.uri, item.fileName, item.mimeType);
    }
  }, [canEdit, uploadOne]);

  const removePhoto = useCallback(async (item: PodPhotoItem) => {
    droppedRef.current.add(item.key);
    if (item.document) droppedRef.current.add(item.document.id);
    setPhotos((current) => current.filter((photo) => photo.key !== item.key));
    setPreview((current) => (current?.key === item.key ? null : current));
    if (!item.document) return;
    const { error } = await deleteTripDocument(item.document);
    if (error) {
      Alert.alert("Could not remove photo", error.message);
      setPhotos((current) =>
        current.some((photo) => photo.key === item.key) ? current : [...current, item],
      );
    }
  }, []);

  if (!canEdit && !loaded) return null;
  if (!canEdit && photos.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Upload POD</Text>
      <Text style={styles.helper}>Upload one or more photos of the physical POD</Text>

      {canEdit ? (
        <Pressable
          style={styles.uploadCard}
          onPress={() => void pickPhotos()}
          accessibilityRole="button"
          accessibilityLabel="Upload POD"
          accessibilityHint="Select one or more photos"
        >
          <Upload size={18} color={Theme.textPrimaryDark} />
          <Text style={styles.uploadTitle}>Upload POD</Text>
          <Text style={styles.uploadHint}>Select one or more photos</Text>
        </Pressable>
      ) : null}

      {photos.length > 0 ? (
        <View style={styles.uploadedBlock}>
          <Text style={styles.uploadedLabel}>Uploaded PODs</Text>
          <View style={styles.grid}>
            {photos.map((item) => (
              <View key={item.key} style={styles.tile}>
                <Pressable
                  onPress={() => {
                    if (item.previewUri) setPreview(item);
                  }}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Preview ${item.fileName}`}
                  style={styles.thumbPress}
                >
                  {item.previewUri ? (
                    <Image source={{ uri: item.previewUri }} style={styles.thumb} resizeMode="cover" />
                  ) : (
                    <View style={styles.thumbFallback} />
                  )}
                  {item.uploading ? (
                    <View style={styles.uploadingBadge}>
                      <ActivityIndicator size="small" color={Theme.textPrimaryDark} />
                    </View>
                  ) : null}
                </Pressable>
                {canEdit ? (
                  <Pressable
                    style={styles.removeBtn}
                    onPress={() => void removePhoto(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.fileName}`}
                  >
                    <X size={12} color={Theme.textPrimaryDark} />
                  </Pressable>
                ) : null}
                <Text style={styles.fileName} numberOfLines={1}>
                  {shortHardCopyPodPhotoName(item.fileName)}
                </Text>
              </View>
            ))}
          </View>
          {canEdit ? (
            <Pressable
              style={styles.addMore}
              onPress={() => void pickPhotos()}
              accessibilityRole="button"
              accessibilityLabel="Add more photos"
            >
              <Upload size={16} color={Theme.textPrimaryDark} />
              <Text style={styles.addMoreText}>Add more photos</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {validationMessage ? <Text style={styles.validation}>{validationMessage}</Text> : null}

      <Modal
        visible={preview != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <Pressable style={styles.previewBackdrop} onPress={() => setPreview(null)}>
          <View style={styles.previewCard} onStartShouldSetResponder={() => true}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {preview ? shortHardCopyPodPhotoName(preview.fileName) : ""}
              </Text>
              <Pressable
                onPress={() => setPreview(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close preview"
              >
                <X size={18} color={Theme.textPrimaryDark} />
              </Pressable>
            </View>
            {preview?.previewUri ? (
              <Image
                source={{ uri: preview.previewUri }}
                style={styles.previewImage}
                resizeMode="contain"
                accessibilityLabel={preview.fileName}
              />
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: Theme.textMuted,
  },
  helper: {
    fontSize: 12,
    color: Theme.textMuted,
    marginBottom: 2,
  },
  uploadCard: {
    minHeight: 88,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    backgroundColor: Theme.cardWhite,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  uploadTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: Theme.textPrimaryDark,
  },
  uploadHint: {
    fontSize: 12,
    color: Theme.textMuted,
  },
  uploadedBlock: { gap: 8, marginTop: 4 },
  uploadedLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Theme.textSecondary,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tile: {
    width: "31%",
    minWidth: 96,
    maxWidth: 140,
    gap: 4,
  },
  thumbPress: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Theme.borderMedium,
    backgroundColor: Theme.screenBackground,
    height: 84,
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbFallback: {
    flex: 1,
    backgroundColor: Theme.border,
  },
  uploadingBadge: {
    position: "absolute",
    left: 4,
    bottom: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
  },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.cardWhite,
    borderWidth: 1,
    borderColor: Theme.borderMedium,
  },
  fileName: {
    fontSize: 10,
    color: Theme.textMuted,
  },
  addMore: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Theme.borderMedium,
    backgroundColor: Theme.cardWhite,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  addMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: Theme.textPrimaryDark,
  },
  validation: {
    fontSize: 11,
    color: Theme.warning,
    fontWeight: "600",
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: Theme.overlayBackdrop,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  previewCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "86%",
    borderRadius: 12,
    backgroundColor: Theme.cardWhite,
    padding: 12,
    gap: 8,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  previewTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: "600",
    color: Theme.textPrimaryDark,
  },
  previewImage: {
    width: "100%",
    height: 360,
    backgroundColor: Theme.screenBackground,
    borderRadius: 8,
  },
});
