/**
 * Regression for Sneha a0ac8ea8 item 2: Compliance trip-document upload
 * (LR / E-way Bill / Invoice) used to be effectively single-file/replacement
 * oriented (`replaceExistingOfType: true`), so adding a second LR silently
 * overwrote the first. Uploads must now be additive.
 */
const mockUploadTripDocument = jest.fn();
jest.mock("@/features/trips/services/tripDocuments.service", () => ({
  uploadTripDocument: (...args: unknown[]) => mockUploadTripDocument(...args),
}));

import { uploadTripDocumentsAdditively } from "@/features/tripCompliance/services/complianceTripDocumentUpload.service";

function asset(overrides: Partial<{ uri: string; name: string; size: number; mimeType: string }> = {}) {
  return {
    uri: "file:///tmp/a.pdf",
    name: "lr.pdf",
    size: 1024,
    mimeType: "application/pdf",
    ...overrides,
  };
}

const readArrayBuffer = async () => new ArrayBuffer(1024);

describe("uploadTripDocumentsAdditively", () => {
  beforeEach(() => {
    mockUploadTripDocument.mockReset();
    mockUploadTripDocument.mockResolvedValue({ doc: { id: "doc-1" }, error: null });
  });

  it("uploads multiple selected files, each as its own additive row (replaceExistingOfType: false)", async () => {
    await uploadTripDocumentsAdditively({
      tripId: "trip-1",
      actorId: "user-1",
      documentType: "lr",
      assets: [asset({ name: "lr-1.pdf" }), asset({ name: "lr-2.pdf" }), asset({ name: "lr-3.pdf" })],
      readArrayBuffer,
    });

    expect(mockUploadTripDocument).toHaveBeenCalledTimes(3);
    for (const call of mockUploadTripDocument.mock.calls) {
      expect(call[5]).toEqual({ replaceExistingOfType: false });
    }
    expect(mockUploadTripDocument.mock.calls[0][2]).toMatchObject({ fileName: "lr-1.pdf" });
    expect(mockUploadTripDocument.mock.calls[1][2]).toMatchObject({ fileName: "lr-2.pdf" });
    expect(mockUploadTripDocument.mock.calls[2][2]).toMatchObject({ fileName: "lr-3.pdf" });
  });

  it("an existing file of the same type remains — upload never requests a replace", async () => {
    await uploadTripDocumentsAdditively({
      tripId: "trip-1",
      actorId: "user-1",
      documentType: "invoice",
      assets: [asset()],
      readArrayBuffer,
    });
    expect(mockUploadTripDocument).toHaveBeenCalledWith(
      "trip-1",
      "user-1",
      expect.any(Object),
      "invoice",
      undefined,
      { replaceExistingOfType: false },
    );
  });

  it("existing single-file behavior remains valid: one asset still uploads exactly once", async () => {
    await uploadTripDocumentsAdditively({
      tripId: "trip-1",
      actorId: "user-1",
      documentType: "eway_bill",
      assets: [asset()],
      readArrayBuffer,
    });
    expect(mockUploadTripDocument).toHaveBeenCalledTimes(1);
  });

  it("stops at the first failing upload and surfaces its error", async () => {
    mockUploadTripDocument
      .mockResolvedValueOnce({ doc: { id: "doc-1" }, error: null })
      .mockResolvedValueOnce({ doc: null, error: new Error("storage quota exceeded") });

    await expect(
      uploadTripDocumentsAdditively({
        tripId: "trip-1",
        actorId: "user-1",
        documentType: "lr",
        assets: [asset({ name: "lr-1.pdf" }), asset({ name: "lr-2.pdf" }), asset({ name: "lr-3.pdf" })],
        readArrayBuffer,
      }),
    ).rejects.toThrow("storage quota exceeded");

    // Third asset is never attempted once the second one fails.
    expect(mockUploadTripDocument).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid file before calling uploadTripDocument at all", async () => {
    await expect(
      uploadTripDocumentsAdditively({
        tripId: "trip-1",
        actorId: "user-1",
        documentType: "lr",
        assets: [asset({ name: "virus.exe", mimeType: "application/x-msdownload" })],
        readArrayBuffer,
      }),
    ).rejects.toThrow();
    expect(mockUploadTripDocument).not.toHaveBeenCalled();
  });
});
