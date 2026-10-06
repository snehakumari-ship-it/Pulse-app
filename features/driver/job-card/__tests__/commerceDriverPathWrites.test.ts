import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

/** Every module the Commerce Job Card executes between a tap and the server. */
const COMMERCE_DRIVER_PATH = [
  'features/driver/job-card/DriverJobCard.tsx',
  'features/driver/job-card/DriverMultiOrderJobCard.tsx',
  'features/driver/job-card/DriverStopVerificationScreen.tsx',
  'features/driver/job-card/DriverTripCompletionScreen.tsx',
  'features/driver/job-card/commerceTripExecution.ts',
  'features/driver/job-card/sesStopsFromCommerceMission.ts',
  'features/driver/job-card/driverRoutePlanMap.ts',
  'features/driver/hooks/useDriverStopExecution.ts',
  'features/driver/execution/transitionDriverStopExecution.ts',
  'features/driver/execution/fetchDriverStopExecution.ts',
  'features/driver/commerce-mission/fetchDriverTripStopOrders.ts',
  'features/driver/commerce-mission/useDriverCommerceMission.ts',
  ...fs
    .readdirSync(path.join(ROOT, 'features/driver/job-card/parts'))
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => `features/driver/job-card/parts/${file}`),
];

function source(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('Commerce driver path has no client-side authority writes', () => {
  it.each(COMMERCE_DRIVER_PATH)('%s does not call updateTripStatus', (file) => {
    expect(source(file)).not.toMatch(/\bupdateTripStatus\s*\(/);
  });

  it.each(COMMERCE_DRIVER_PATH)('%s does not write trips, SES, or orders', (file) => {
    const text = source(file);
    expect(text).not.toMatch(/\.from\(\s*['"](trips|sales_orders|sales_order_lines|products)['"]/);
    expect(text).not.toMatch(/\.(update|insert|upsert|delete)\s*\(/);
  });

  it('SES is read-only and stop transitions go through driver_execute_command', () => {
    expect(source('features/driver/execution/fetchDriverStopExecution.ts')).toMatch(
      /\.from\('stop_execution_state'\)\s*\.select\(/,
    );
    const transition = source('features/driver/execution/transitionDriverStopExecution.ts');
    expect(transition).toMatch(/executeDriverCommand\(/);
    expect(transition).toMatch(/'ARRIVE_STOP'/);
    expect(transition).toMatch(/'COMPLETE_STOP'/);
    expect(source('features/driver/job-card/DriverMultiOrderJobCard.tsx')).toMatch(
      /executeDriverCommand\(\s*\{\s*tripId: trip\.id, command: 'COMPLETE_TRIP' \}/,
    );
  });
});
