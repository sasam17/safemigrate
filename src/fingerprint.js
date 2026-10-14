// Cross-border recruiter fingerprints. A recruiter's phone, WhatsApp number,
// email or Facebook page is turned into a keyed HMAC, so a number reported in
// Nepal can warn a worker in Pakistan or the Philippines without anyone ever
// storing (or being able to recover) the raw contact.
import { createHmac } from 'node:crypto';

const SECRET = process.env.FINGERPRINT_SECRET || 'dev-only-fingerprint-secret';
if (!process.env.FINGERPRINT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[fingerprint] FINGERPRINT_SECRET is not set; using the dev secret.');
}

const useFirestore = process.env.USE_FIRESTORE === '1';
const memory = new Map();

/** @returns {{kind: string, key: string} | null} */
export function normalizeContact(kind, raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if (kind === 'phone') {
    let digits = value.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    return digits.length >= 8 ? { kind, key: digits } : null;
  }
  if (kind === 'email') return /.+@.+\..+/.test(value) ? { kind, key: value } : null;
  if (kind === 'facebook') {
    const handle = value.replace(/^https?:\/\/(www\.|m\.)?(facebook|fb)\.com\//, '').replace(/[/?#].*$/, '');
    return handle.length >= 3 ? { kind, key: handle } : null;
  }
  return null;
}

const hmac = (c) => createHmac('sha256', SECRET).update(`${c.kind}:${c.key}`).digest('hex');

// Only the last 3 characters are kept, so the UI can say "…567" without leaking the contact.
const maskHint = (c) => `${c.kind}:…${c.key.slice(-3)}`;

/** Builds de-duplicated fingerprints from the extracted facts. */
export function fingerprintsFrom(facts = {}) {
  const contacts = [
    ...(facts.recruiter_phones ?? []).map((v) => normalizeContact('phone', v)),
    ...(facts.recruiter_emails ?? []).map((v) => normalizeContact('email', v)),
    ...(facts.recruiter_facebook ?? []).map((v) => normalizeContact('facebook', v)),
  ].filter(Boolean);
  const seen = new Map();
  for (const c of contacts) {
    const id = hmac(c);
    seen.set(id, { id, kind: c.kind, hint: maskHint(c) });
  }
  return [...seen.values()];
}

/** Pure merge of one report into a fingerprint record. */
export function mergeReport(prev, { kind, risk, origin, destination, now }) {
  const bump = (obj, key) => (key ? { ...(obj ?? {}), [key]: ((obj ?? {})[key] ?? 0) + 1 } : (obj ?? {}));
  return {
    kind,
    reports: (prev?.reports ?? 0) + 1,
    highRisk: (prev?.highRisk ?? 0) + (risk === 'high' ? 1 : 0),
    origins: bump(prev?.origins, origin),
    destinations: bump(prev?.destinations, destination),
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
  };
}

async function db() {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

async function readRecord(id) {
  if (!useFirestore) return memory.get(id) ?? null;
  const snap = await (await db()).collection('fingerprints').doc(id).get();
  return snap.exists ? snap.data() : null;
}

/** Returns prior reports for each fingerprint that has been seen before. */
export async function lookupFingerprints(prints) {
  const out = [];
  for (const p of prints) {
    try {
      const rec = await readRecord(p.id);
      if (rec) out.push({ ...p, reports: rec.reports, highRisk: rec.highRisk, origins: rec.origins, destinations: rec.destinations });
    } catch (err) {
      console.error('[fingerprint] lookup failed:', err.message);
    }
  }
  return out;
}

/** Records this check against each fingerprint (medium/high risk only). */
export async function recordFingerprints(prints, { risk, origin, destination }) {
  if (risk === 'low' || prints.length === 0) return;
  const now = new Date().toISOString();
  for (const p of prints) {
    try {
      if (!useFirestore) {
        memory.set(p.id, mergeReport(memory.get(p.id), { kind: p.kind, risk, origin, destination, now }));
        continue;
      }
      const fs = await db();
      const ref = fs.collection('fingerprints').doc(p.id);
      await fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        tx.set(ref, mergeReport(snap.exists ? snap.data() : null, { kind: p.kind, risk, origin, destination, now }));
      });
    } catch (err) {
      console.error('[fingerprint] record failed:', err.message);
    }
  }
}
