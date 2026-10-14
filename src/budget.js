// Daily spending lock: every Gemini-powered action (check, voice, translation,
// complaint) uses one unit; when today's units run out the app politely asks
// people to come back tomorrow. Counted in Firestore so all Cloud Run
// instances share one limit; in memory when running locally.
const DAILY_LIMIT = Number(process.env.DAILY_AI_LIMIT) || 1500;
const useFirestore = process.env.USE_FIRESTORE === '1';
const memory = new Map(); // 'YYYY-MM-DD' -> count

export const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** Pure check used by both stores. */
export function allow(used, cost, limit = DAILY_LIMIT) {
  return used + cost <= limit;
}

async function db() {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

/**
 * Reserves `cost` units for today. Returns true if allowed.
 * If the counter itself is unreachable we allow the call (availability over
 * strictness); Cloud Run's max-instances cap still bounds spend.
 */
export async function consume(kind, cost = 1) {
  const day = todayKey();
  if (!useFirestore) {
    const used = memory.get(day) ?? 0;
    if (!allow(used, cost)) return false;
    memory.set(day, used + cost);
    return true;
  }
  try {
    const fs = await db();
    const ref = fs.collection('usage').doc(day);
    return await fs.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const used = data.total ?? 0;
      if (!allow(used, cost)) return false;
      tx.set(ref, { ...data, total: used + cost, [kind]: (data[kind] ?? 0) + cost, updatedAt: new Date().toISOString() });
      return true;
    });
  } catch (err) {
    console.error('[budget] counter unavailable, allowing:', err.message);
    return true;
  }
}

export const LIMIT_MESSAGE = {
  en: "Today's free checks are used up. Please try again tomorrow.",
  ne: 'आजका निःशुल्क जाँचहरू सकिए। भोलि फेरि प्रयास गर्नुहोस्।',
};
