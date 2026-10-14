// Uploads the registry snapshots and fraud list into Firestore.
// Usage (with GOOGLE_CLOUD_PROJECT set and gcloud ADC login): npm run seed
import { readFileSync, existsSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BATCH_SIZE = 400;
const file = (name) => new URL(`../data/${name}`, import.meta.url);
const read = (name) => (existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : null);
const docId = (s) => String(s).replace(/[/\s.#$[\]]+/g, '_').slice(0, 120);

initializeApp();
const db = getFirestore();

async function writeAll(collection, rows, idOf) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const row of rows.slice(i, i + BATCH_SIZE)) batch.set(db.collection(collection).doc(idOf(row)), row);
    await batch.commit();
  }
}

for (const code of ['NP', 'PK', 'PH']) {
  const snap = read(`agencies-${code.toLowerCase()}.json`);
  if (!snap) {
    console.log(`[seed] ${code}: no snapshot, skipped`);
    continue;
  }
  const agencies = snap.agencies.map((a) => ({ ...a, country: code }));
  await writeAll('agencies', agencies, (a) => `${code}_${docId(a.license_no || a.name)}`);
  await db.collection('registry_meta').doc(code).set({ source: snap.source, fetchedAt: snap.fetchedAt, count: agencies.length });
  console.log(`[seed] ${code}: ${agencies.length} agencies`);
}

const fraud = read('fraud-list.json') ?? [];
await writeAll('fraud_list', fraud, (f) => docId(`${f.name}_${f.notice_ref}`));
console.log(`[seed] fraud list: ${fraud.length}`);
