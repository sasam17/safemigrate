// Name matching for agency and fraud-list lookups. Pure functions, no I/O.

const NOISE = /\b(pvt|p|private|ltd|limited|co|company|inc|the|and|nepal|services?)\b/g;

export function normalizeName(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[.,&()/'"-]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(name) {
  return new Set(normalizeName(name).split(' ').filter((t) => t.length > 1));
}

export function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

const normLicense = (v) => String(v ?? '').replace(/\D/g, '');
const leadingNumber = (v) => {
  const m = String(v ?? '').match(/\d+/);
  return m ? String(Number(m[0])) : '';
};

/**
 * @param {{name?: string, license_no?: string}} query
 * @param {Array<{name: string, license_no?: string}>} agencies
 * @returns {{agency: object, score: number, by: 'license'|'name'} | null}
 */
export function findAgency(query, agencies) {
  const lic = normLicense(query.license_no);
  if (lic) {
    const hit = agencies.find((a) => normLicense(a.license_no) === lic);
    if (hit) return { agency: hit, score: 1, by: 'license' };
    // Workers often quote only the first part ("892" for "892/067/068").
    const lead = leadingNumber(query.license_no);
    const byLead = lead ? agencies.filter((a) => leadingNumber(a.license_no) === lead) : [];
    if (byLead.length === 1) return { agency: byLead[0], score: 0.9, by: 'license' };
  }
  if (!query.name) return null;
  let best = null;
  for (const agency of agencies) {
    const score = similarity(query.name, agency.name);
    if (!best || score > best.score) best = { agency, score, by: 'name' };
  }
  return best && best.score >= 0.75 ? best : null;
}

/**
 * Exact-token person matching: every token of the listed name must appear in
 * the query, so "Ram" alone never matches "Ram Bahadur Thapa".
 */
export function findPeople(names, list) {
  const out = [];
  for (const name of names ?? []) {
    const q = tokens(name);
    if (q.size < 2) continue;
    for (const entry of list) {
      const e = tokens(entry.name);
      if (e.size >= 2 && [...e].every((t) => q.has(t))) out.push({ ...entry, query: name });
    }
  }
  return out;
}
