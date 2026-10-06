import { compressLocalImageForUpload } from '@/lib/media/compressLocalImage.util';
import * as tripDocumentsService from '@/features/trips/services/tripDocuments.service';
import {
  encodeDeliveryPlace,
  type DeliveryProofDraft,
} from '@/features/driver/job-card/deliveryProof';

function textBody(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Proof items already uploaded for one stop, keyed by `place:<code>` / `photo:<uri>` → document id. */
export type StopProofLedger = Map<string, string | null>;

/**
 * Persist stop-level proof using existing trip_documents (document_type=pod).
 * Pickup and delivery both store a photo and/or a short place note.
 * With a ledger, items already uploaded are skipped, so retrying a failed
 * COMPLETE_STOP never uploads the same proof twice.
 */
export async function persistStopDeliveryProof(input: {
  tripId: string;
  stopId: string;
  uploadedBy: string;
  draft: DeliveryProofDraft;
  kind?: 'pickup' | 'delivery';
  ledger?: StopProofLedger;
}): Promise<{ ok: true } | { ok: false; error: Error }> {
  const pickup = input.kind === 'pickup';
  const place = encodeDeliveryPlace(input.draft.place, input.draft.placeNote);
  const photos = input.draft.photoUris.filter((uri) => uri.trim());
  const ledger = input.ledger;

  try {
    if (photos.length === 0) {
      if (!place) return { ok: true };
      const key = `place:${place}`;
      if (ledger?.has(key)) return { ok: true };
      const { doc, error } = await tripDocumentsService.uploadTripDocument(
        input.tripId,
        input.uploadedBy,
        {
          arrayBuffer: textBody(place),
          fileName: pickup ? 'pickup-place.txt' : 'delivery-place.txt',
          mimeType: 'text/plain',
        },
        'pod',
        place,
        { stopId: input.stopId },
      );
      if (error) return { ok: false, error };
      ledger?.set(key, doc?.id ?? null);
      return { ok: true };
    }

    for (const uri of photos) {
      const key = `photo:${uri}`;
      if (ledger?.has(key)) continue;
      const compressed = await compressLocalImageForUpload(uri);
      const { doc, error } = await tripDocumentsService.uploadTripDocument(
        input.tripId,
        input.uploadedBy,
        {
          arrayBuffer: compressed.arrayBuffer,
          fileName: `${pickup ? 'pop' : 'pod'}-${Date.now()}.jpg`,
          mimeType: compressed.mimeType,
        },
        'pod',
        place ?? undefined,
        { stopId: input.stopId },
      );
      if (error) return { ok: false, error };
      ledger?.set(key, doc?.id ?? null);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error('Could not save stop proof'),
    };
  }
}

