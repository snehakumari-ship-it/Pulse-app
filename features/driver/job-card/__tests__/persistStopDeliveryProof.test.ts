import { persistStopDeliveryProof } from '@/features/driver/job-card/persistStopDeliveryProof';

const mockUpload = jest.fn();

jest.mock('@/features/trips/services/tripDocuments.service', () => ({
  uploadTripDocument: (...args: unknown[]) => mockUpload(...args),
}));

jest.mock('@/lib/media/compressLocalImage.util', () => ({
  compressLocalImageForUpload: async () => ({
    arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
    mimeType: 'image/jpeg',
  }),
}));

describe('persistStopDeliveryProof', () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ doc: { id: 'd1' }, error: null });
  });

  it('uploads a place note when there is no photo', async () => {
    const result = await persistStopDeliveryProof({
      tripId: 't1',
      stopId: 's1',
      uploadedBy: 'u1',
      draft: { place: 'left_at_door', placeNote: '', photoUris: [] },
    });
    expect(result).toEqual({ ok: true });
    expect(mockUpload).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ fileName: 'delivery-place.txt', mimeType: 'text/plain' }),
      'pod',
      'left_at_door',
      { stopId: 's1' },
    );
  });

  it('uploads photos with the place code', async () => {
    const result = await persistStopDeliveryProof({
      tripId: 't1',
      stopId: 's1',
      uploadedBy: 'u1',
      draft: { place: 'handed_to_recipient', placeNote: '', photoUris: ['file://a.jpg'] },
    });
    expect(result).toEqual({ ok: true });
    expect(mockUpload).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ mimeType: 'image/jpeg' }),
      'pod',
      'handed_to_recipient',
      { stopId: 's1' },
    );
  });

  it('uploads pickup place notes separately from delivery', async () => {
    const result = await persistStopDeliveryProof({
      tripId: 't1',
      stopId: 's1',
      uploadedBy: 'u1',
      kind: 'pickup',
      draft: { place: 'collected_from_warehouse', placeNote: '', photoUris: [] },
    });
    expect(result).toEqual({ ok: true });
    expect(mockUpload).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ fileName: 'pickup-place.txt', mimeType: 'text/plain' }),
      'pod',
      'collected_from_warehouse',
      { stopId: 's1' },
    );
  });
  describe('retry-safe ledger', () => {
    it('a retried place-only proof is not uploaded again', async () => {
      const ledger = new Map<string, string | null>();
      const input = {
        tripId: 't1',
        stopId: 's1',
        uploadedBy: 'u1',
        draft: { place: 'left_at_door' as const, placeNote: '', photoUris: [] },
        ledger,
      };
      expect(await persistStopDeliveryProof(input)).toEqual({ ok: true });
      expect(await persistStopDeliveryProof(input)).toEqual({ ok: true });
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(ledger.get('place:left_at_door')).toBe('d1');
    });

    it('after a partial photo failure, the retry uploads only the photo that failed', async () => {
      const ledger = new Map<string, string | null>();
      const input = {
        tripId: 't1',
        stopId: 's1',
        uploadedBy: 'u1',
        draft: { place: 'handed_to_recipient' as const, placeNote: '', photoUris: ['file://a.jpg', 'file://b.jpg'] },
        ledger,
      };
      mockUpload
        .mockResolvedValueOnce({ doc: { id: 'doc-a' }, error: null })
        .mockResolvedValueOnce({ doc: null, error: new Error('network') });
      const first = await persistStopDeliveryProof(input);
      expect(first.ok).toBe(false);
      expect([...ledger.keys()]).toEqual(['photo:file://a.jpg']);

      mockUpload.mockResolvedValueOnce({ doc: { id: 'doc-b' }, error: null });
      expect(await persistStopDeliveryProof(input)).toEqual({ ok: true });
      expect(mockUpload).toHaveBeenCalledTimes(3);
      expect(ledger.get('photo:file://b.jpg')).toBe('doc-b');

      expect(await persistStopDeliveryProof(input)).toEqual({ ok: true });
      expect(mockUpload).toHaveBeenCalledTimes(3);
    });

    it('a different proof choice for the same stop is still uploaded', async () => {
      const ledger = new Map<string, string | null>();
      const base = { tripId: 't1', stopId: 's1', uploadedBy: 'u1', ledger };
      await persistStopDeliveryProof({ ...base, draft: { place: 'left_at_door', placeNote: '', photoUris: [] } });
      await persistStopDeliveryProof({ ...base, draft: { place: 'left_with_security', placeNote: '', photoUris: [] } });
      expect(mockUpload).toHaveBeenCalledTimes(2);
    });
  });
});
