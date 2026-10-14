// Data layer. On Cloud Run it reads each country's licensed-agency registry and
// the fraud list from Firestore and writes anonymised cases there. Locally (no
// project configured) it falls back to the JSON snapshots in /data and memory.
import { readFileSync, existsSync } from 'node:fs';
import { findAgency, findPeople } from './match.js';

const PACK_CODES = ['NP', 'PK', 'PH'];
const dataFile = (name) => new URL(`../data/${name}`, import.meta.url);

function readJson(name, fallback) {
  const url = dataFile(name);
  if (!existsSync(url)) return fallback;
  try {
    return JSON.parse(readFileSync(url, 'utf8'));
  } catch (err) {
    console.error(`[store] could not parse data/${name}:`, err.message);
    return fallback;
  }
}

const useFirestore = process.env.USE_FIRESTORE === '1';
let db = null;
/** @type {Record<string, {meta: object|null, agencies: object[]}>} */
const registries = Object.fromEntries(PACK_CODES.map((c) => [c, { meta: null, agencies: [] }]));
let fraudList = [];
const memoryCases = [];

async function firestore() {
  if (db) return db;
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp();
  db = getFirestore();
  return db;
}

async function loadFromFirestore() {
  const fs = await firestore();
  const [agencySnap, metaSnap, fraudSnap] = await Promise.all([
    fs.collection('agencies').get(),
    fs.collection('registry_meta').get(),
    fs.collection('fraud_list').get(),
  ]);
  for (const doc of agencySnap.docs) {
    const a = doc.data();
    registries[a.country]?.agencies.push(a);
  }
  for (const doc of metaSnap.docs) {
    if (registries[doc.id]) registries[doc.id].meta = doc.data();
  }
  fraudList = fraudSnap.docs.map((d) => d.data());
}

export async function loadReferenceData() {
  if (useFirestore) {
    try {
      await loadFromFirestore();
    } catch (err) {
      console.error('[store] Firestore load failed, using JSON snapshots:', err.message);
    }
  }
  for (const code of PACK_CODES) {
    if (registries[code].agencies.length > 0) continue;
    const snap = readJson(`agencies-${code.toLowerCase()}.json`, null);
    if (snap) registries[code] = { meta: { source: snap.source, fetchedAt: snap.fetchedAt, count: snap.agencies.length }, agencies: snap.agencies };
  }
  if (fraudList.length === 0) fraudList = readJson('fraud-list.json', []);
  return { ...referenceStats(), firestore: useFirestore };
}

export function registryMeta(origin) {
  return registries[origin]?.meta ?? null;
}

/** Tool: look up a recruitment agency in the origin country's licensed register. */
export function lookupAgency({ name, license_no, origin = 'NP' }) {
  if (!name && !license_no) return { status: 'not_mentioned' };
  const query = name || `licence ${license_no}`;
  const reg = registries[origin] ?? registries.NP;
  if (reg.agencies.length === 0) return { status: 'unavailable', query };
  const hit = findAgency({ name, license_no }, reg.agencies);
  if (!hit) return { status: 'not_found', query, checked: reg.agencies.length };
  return { status: 'found', query, by: hit.by, score: hit.score, agency: hit.agency };
}

/** Tool: check people/companies against published fraud-accused notices. */
export function checkFraudList({ names }) {
  return findPeople(names, fraudList);
}

export function referenceStats() {
  return {
    agencies: Object.fromEntries(PACK_CODES.map((c) => [c, registries[c].agencies.length])),
    fraudList: fraudList.length,
  };
}

/** Saves only non-identifying fields so the public map never exposes a worker. */
export async function saveCase({ origin, country, risk, flagIds, agencyStatus }) {
  const record = {
    origin: origin ?? 'NP',
    country: country ?? 'Unknown',
    risk,
    flags: flagIds,
    agencyStatus: agencyStatus ?? 'not_mentioned',
    createdAt: new Date().toISOString(),
  };
  if (useFirestore) {
    try {
      await (await firestore()).collection('cases').add(record);
      return record;
    } catch (err) {
      console.error('[store] saveCase failed:', err.message);
    }
  }
  memoryCases.push(record);
  return record;
}

export async function recentCases(limit = 500) {
  if (useFirestore) {
    try {
      const snap = await (await firestore()).collection('cases').orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map((d) => d.data());
    } catch (err) {
      console.error('[store] recentCases failed:', err.message);
    }
  }
  return memoryCases.slice(-limit).reverse();
}
