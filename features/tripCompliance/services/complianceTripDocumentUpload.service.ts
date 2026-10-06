/**
 * Additive trip-document upload for the Compliance review sheet. Each
 * selected file becomes its own `trip_documents` row for the given type
 * instead of overwriting the existing file of that type — the review
 * sheet's own row derivation already shows only the latest file per type
 * (`latestDocByType` in complianceDocumentRows.util.ts), so this changes
 * what's stored, not what's displayed by default.
 *
 * Extracted out of ComplianceDocumentReviewSheet.tsx (which transitively
 * imports lucide-react-native / react-native-svg and so can't be imported
 * from a plain jest test) so this upload-loop logic stays independently
 * unit-testable.
 */
import { validateComplianceTripDocumentFile } from "@/features/tripCompliance/utils/complianceTripDocumentFormat.util";
import { uploadTripDocument, type TripDocumentType } from "@/features/trips/services/tripDocuments.service";

export type PickedComplianceDocumentAsset = {
  uri: string;
  name?: string | null;
  size?: number | null;
  mimeType?: string | null;
};

/**
 * Uploads every asset as its own additive trip_documents row
 * (`replaceExistingOfType: false`). Throws on the first validation or upload
 * failure — matching `uploadTripDocument`'s own convention — so callers can
 * reuse their existing catch-block handling (e.g. a storage-path-conflict
 * soft-success) unchanged.
 */
export async function uploadTripDocumentsAdditively(params: {
  tripId: string;
  actorId: string;
  documentType: TripDocumentType;
  assets: ReadonlyArray<PickedComplianceDocumentAsset>;
  /** Overridable for tests; defaults to `fetch(uri).then(r => r.arrayBuffer())`. */
  readArrayBuffer?: (uri: string) => Promise<ArrayBuffer>;
}): Promise<void> {
  const readArrayBuffer =
    params.readArrayBuffer ?? ((uri: string) => fetch(uri).then((r) => r.arrayBuffer()));

  for (const asset of params.assets) {
    const fileName = asset.name ?? `${params.documentType}.pdf`;
    if (typeof asset.size === "number") {
      const early = validateComplianceTripDocumentFile({
        fileName,
        mimeType: asset.mimeType,
        byteLength: asset.size,
      });
      if (!early.ok) throw new Error(early.reason);
    }
    const arrayBuffer = await readArrayBuffer(asset.uri);
    const format = validateComplianceTripDocumentFile({
      fileName,
      mimeType: asset.mimeType,
      byteLength: arrayBuffer.byteLength,
    });
    if (!format.ok) throw new Error(format.reason);

    const { error } = await uploadTripDocument(
      params.tripId,
      params.actorId,
      { arrayBuffer, fileName, mimeType: format.mimeType },
      params.documentType,
      undefined,
      { replaceExistingOfType: false },
    );
    if (error) throw error;
  }
}
