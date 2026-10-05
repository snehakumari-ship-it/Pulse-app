const { rewriteMetroBundleUrl } = require('../webChunkRecovery');

const ORIGIN = 'http://localhost:8081';
const QS =
  'platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.baseUrl=%2Fdriver';

describe('rewriteMetroBundleUrl', () => {
  it('strips /driver from a nested-route lazy chunk so Metro is hit at /apps/...bundle', () => {
    const input = `${ORIGIN}/driver/trip-history/apps/driver/features/drivers/screens/DriverTripHistoryScreen.bundle?${QS}`;
    const out = rewriteMetroBundleUrl(input, ORIGIN);
    expect(out).toBe(
      `${ORIGIN}/apps/driver/features/drivers/screens/DriverTripHistoryScreen.bundle?${QS}`,
    );
    expect(out.includes('/driver/apps/')).toBe(false);
  });

  it('strips /driver from a one-segment nested lazy chunk', () => {
    const input = `${ORIGIN}/driver/apps/driver/features/drivers/screens/DriverWalletScreen.bundle?${QS}`;
    const out = rewriteMetroBundleUrl(input, ORIGIN);
    expect(out).toBe(
      `${ORIGIN}/apps/driver/features/drivers/screens/DriverWalletScreen.bundle?${QS}`,
    );
    expect(out.includes('/driver/apps/')).toBe(false);
  });

  it('strips a two-segment app route prefix that is not /driver', () => {
    const input = `${ORIGIN}/available-loads/test-id/apps/driver/features/driver/components/AvailableLoadDetailScreen.bundle?${QS}`;
    const out = rewriteMetroBundleUrl(input, ORIGIN);
    expect(out).toBe(
      `${ORIGIN}/apps/driver/features/driver/components/AvailableLoadDetailScreen.bundle?${QS}`,
    );
  });

  it('strips a nested route prefix from this repo features chunk', () => {
    const input = `${ORIGIN}/driver/trip-history/features/drivers/screens/DriverTripHistoryScreen.bundle?${QS}`;
    const out = rewriteMetroBundleUrl(input, ORIGIN);
    expect(out).toBe(
      `${ORIGIN}/features/drivers/screens/DriverTripHistoryScreen.bundle?${QS}`,
    );
    expect(out.includes('/driver/')).toBe(false);
  });

  it('strips a deeper market-detail prefix from a features chunk', () => {
    const input = `${ORIGIN}/available-loads/test-id/features/driver/components/AvailableLoadDetailScreen.bundle?${QS}`;
    const out = rewriteMetroBundleUrl(input, ORIGIN);
    expect(out).toBe(
      `${ORIGIN}/features/driver/components/AvailableLoadDetailScreen.bundle?${QS}`,
    );
  });

  it('does not rewrite an already-correct Metro /apps/...bundle URL', () => {
    const input = `${ORIGIN}/apps/driver/features/drivers/screens/DriverWalletScreen.bundle?${QS}`;
    expect(rewriteMetroBundleUrl(input, ORIGIN)).toBe(input);
  });

  it('does not rewrite an already-correct Metro /features/...bundle URL', () => {
    const input = `${ORIGIN}/features/drivers/screens/DriverWalletScreen.bundle?${QS}`;
    expect(rewriteMetroBundleUrl(input, ORIGIN)).toBe(input);
  });

  it('does not rewrite the entry bundle at /node_modules/...bundle', () => {
    const input = `${ORIGIN}/node_modules/expo-router/entry.bundle?${QS}`;
    expect(rewriteMetroBundleUrl(input, ORIGIN)).toBe(input);
  });

  it('does not rewrite a same-origin API URL', () => {
    const input = `${ORIGIN}/rest/v1/drivers?select=id`;
    expect(rewriteMetroBundleUrl(input, ORIGIN)).toBe(input);
  });

  it('does not rewrite a same-origin asset URL', () => {
    const input = `${ORIGIN}/assets/icon.png`;
    expect(rewriteMetroBundleUrl(input, ORIGIN)).toBe(input);
  });

  it('does not rewrite a cross-origin .bundle URL', () => {
    const input = 'https://cdn.example.com/driver/apps/chunk.bundle';
    expect(rewriteMetroBundleUrl(input, ORIGIN)).toBe(input);
  });
});
