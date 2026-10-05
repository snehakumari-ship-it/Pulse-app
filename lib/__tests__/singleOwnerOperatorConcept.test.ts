/**
 * DCO (Driver-come-Owner) is the only owner-operator concept. A separate
 * "Fleet Owner" capability, onboarding path or authorization branch must not
 * come back into the Driver App source.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['app', 'features', 'lib', 'components'];
const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;
const SELF = path.resolve(__filename);

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'Fleet Owner capability hook', pattern: /useDriverFleetOwnerQuery/ },
  { label: 'Fleet Owner capability flag', pattern: /\bisFleetOwner\b/ },
  { label: 'Fleet Owner enablement', pattern: /enableDriverFleetOwner|enable_driver_fleet_owner/ },
  { label: 'Fleet Owner capability table', pattern: /driver_fleet_owner_profiles/ },
  { label: 'Fleet Owner onboarding route', pattern: /become-fleet-owner|driverBecomeFleetOwner/ },
  { label: 'Fleet Owner onboarding copy', pattern: /Become a Fleet Owner/i },
  { label: 'Duplicate Marketplace OR-authorization', pattern: /isFleetOwner\s*\|\||\|\|\s*isFleetOwner|is_fleet_owner\s*\|\||\|\|\s*is_fleet_owner/ },
];

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (
      SOURCE_EXT.test(entry.name) &&
      path.resolve(full) !== SELF &&
      !/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
}

describe('single owner-operator concept', () => {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(REPO_ROOT, d), files);

  it('scans the Driver App surfaces', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(FORBIDDEN)('has no $label', ({ pattern }) => {
    const hits = files
      .filter((f) => pattern.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO_ROOT, f))
      .filter((f) => f !== 'lib/database.types.ts');
    expect(hits).toEqual([]);
  });

  it('has no Fleet Owner screen file', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'app/(driver)/become-fleet-owner.tsx'))).toBe(false);
  });
});
