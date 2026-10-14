// Converts raw registry captures in data/raw/ into the normalised snapshots
// the app loads: data/agencies-<country>.json = {source, fetchedAt, agencies[]}.
// Usage: node scripts/import-registries.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const raw = (name) => new URL(`../data/raw/${name}.json`, import.meta.url);
const out = (name) => new URL(`../data/${name}`, import.meta.url);

// BEOE statuses seen in the register; only these mean the licence is usable.
const PK_ACTIVE = new Set(['valid', 'active', 'licensed', 'renewed']);

function importPakistan() {
  if (!existsSync(raw('pk-beoe-oeps'))) return null;
  const src = JSON.parse(readFileSync(raw('pk-beoe-oeps'), 'utf8'));
  const byLicence = new Map();
  for (const row of src.rows) {
    const [licence, proprietor, title, status, expiry, headOffice] = row;
    if (!licence || !title) continue;
    byLicence.set(licence, {
      license_no: licence,
      name: title,
      proprietor,
      status,
      active: PK_ACTIVE.has(String(status).toLowerCase()),
      expiry,
      address: headOffice,
      country: 'PK',
    });
  }
  const agencies = [...byLicence.values()];
  const snapshot = { source: src.source, fetchedAt: src.fetchedAt, agencies };
  writeFileSync(out('agencies-pk.json'), JSON.stringify(snapshot));
  const statuses = {};
  for (const a of agencies) statuses[a.status] = (statuses[a.status] ?? 0) + 1;
  return { country: 'PK', agencies: agencies.length, active: agencies.filter((a) => a.active).length, statuses };
}

const results = [importPakistan()].filter(Boolean);
console.log(JSON.stringify(results, null, 2));
