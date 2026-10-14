// Deterministic red-flag engine. Gemini extracts the facts; this file decides
// the risk so the verdict is explainable, testable and never hallucinated.
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const RULES = load('destination-rules.json');
export const PACKS = load('packs.json');

export function getPack(code) {
  const key = String(code ?? 'NP').toUpperCase();
  return PACKS[key] && key !== '_ABOUT' ? PACKS[key] : PACKS.NP;
}

const COUNTRY_ALIASES = {
  uae: 'United Arab Emirates',
  'u.a.e': 'United Arab Emirates',
  dubai: 'United Arab Emirates',
  'abu dhabi': 'United Arab Emirates',
  sharjah: 'United Arab Emirates',
  'united arab emirates': 'United Arab Emirates',
  ksa: 'Saudi Arabia',
  saudi: 'Saudi Arabia',
  'saudi arabia': 'Saudi Arabia',
  riyadh: 'Saudi Arabia',
  jeddah: 'Saudi Arabia',
  qatar: 'Qatar',
  doha: 'Qatar',
  kuwait: 'Kuwait',
  bahrain: 'Bahrain',
  oman: 'Oman',
  muscat: 'Oman',
  malaysia: 'Malaysia',
  'kuala lumpur': 'Malaysia',
};

export const SEVERITY = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });

export function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return COUNTRY_ALIASES[key] ?? raw.trim();
}

function flag(id, severity, en, np, source) {
  return { id, severity, title_en: en, title_np: np, source: source ?? null };
}

const fmt = (n) => n.toLocaleString('en-IN');

function agencyFlags(agencyLookup, pack) {
  const src = pack.registry_url;
  if (!agencyLookup || agencyLookup.status === 'not_mentioned') {
    return [flag('no_agency', SEVERITY.MEDIUM,
      `No licensed recruitment agency is named. Legal offers come through an agency licensed by the ${pack.regulator}.`,
      'कुनै इजाजतप्राप्त म्यानपावर कम्पनीको नाम छैन। वैध रोजगारी इजाजतप्राप्त संस्था वा व्यक्तिगत श्रम स्वीकृतिबाट मात्र हुन्छ।', src)];
  }
  if (agencyLookup.status === 'not_found') {
    return [flag('agency_not_licensed', SEVERITY.HIGH,
      `"${agencyLookup.query}" was not found in the ${pack.registry_name}.`,
      `"${agencyLookup.query}" सरकारी इजाजतप्राप्त संस्थाको सूचीमा भेटिएन।`, src)];
  }
  if (agencyLookup.status === 'found' && agencyLookup.agency?.active === false) {
    return [flag('agency_inactive', SEVERITY.HIGH,
      `The agency's licence status is "${agencyLookup.agency.status}", not valid.`,
      `यो संस्थाको इजाजत "${agencyLookup.agency.status}" छ, मान्य छैन।`, src)];
  }
  if (agencyLookup.status === 'unavailable') {
    return [flag('agency_unverified', SEVERITY.LOW,
      `The ${pack.registry_name} could not be checked right now. Verify the licence number yourself before paying.`,
      'अहिले सरकारी सूची जाँच गर्न सकिएन। पैसा तिर्नु अघि इजाजत नम्बर आफैं जाँच्नुहोस्।', src)];
  }
  return [];
}

function feeFlags(facts, country, pack) {
  const fee = Number(facts.fee_demanded_npr ?? facts.fee_amount);
  if (!Number.isFinite(fee) || fee <= 0) return [];
  const currency = facts.fee_demanded_npr ? 'NPR' : (facts.fee_currency || pack.currency);
  const fvft = RULES.free_visa_free_ticket;
  const capped = pack.fee_rule === 'free_visa_free_ticket' && currency === 'NPR'
    && country && fvft.countries.includes(country);
  if (capped && fee <= fvft.max_service_charge_npr) return [];
  if (capped) {
    return [flag('fee_over_cap', SEVERITY.HIGH,
      `NPR ${fmt(fee)} is demanded, but for ${country} the agency service charge is capped at NPR ${fmt(fvft.max_service_charge_npr)} and the employer should pay visa and ticket.`,
      `रु ${fmt(fee)} मागिएको छ, तर ${country} का लागि सेवा शुल्क बढीमा रु १०,००० हो र भिसा तथा टिकट रोजगारदाताले तिर्नुपर्छ।`,
      fvft.sources[0])];
  }
  return [flag('fee_demanded', SEVERITY.LOW,
    `${currency} ${fmt(fee)} is demanded. Pay only to the licensed agency's account and always get an official receipt.`,
    `${currency} ${fmt(fee)} मागिएको छ। इजाजतप्राप्त संस्थाको खातामा मात्र तिर्नुहोस् र रसिद लिनुहोस्।`, null)];
}

function sectorFlags(facts, country) {
  const cfg = RULES.scam_compound_sectors;
  const text = [facts.job_title, ...(facts.sector_keywords ?? [])].join(' ').toLowerCase();
  const hits = cfg.keywords.filter((k) => text.includes(k));
  const riskyCountry = country && cfg.high_risk_countries.includes(country);
  const gambling = hits.some((k) => ['casino', 'igaming', 'online gaming', 'betting'].includes(k));
  if (riskyCountry || gambling || (hits.length > 0 && facts.visa_type === 'visit')) {
    return [flag('scam_centre_pattern', SEVERITY.HIGH,
      'This matches a known trafficking pattern: online "customer service / data entry / gaming" jobs used to recruit people into scam centres.',
      'यो ठगी केन्द्रमा मानिस पुर्‍याउने ज्ञात ढाँचासँग मिल्छ: अनलाइन "कस्टमर सर्भिस / डाटा इन्ट्री / गेमिङ" काम।', null)];
  }
  return [];
}

function behaviourFlags(facts) {
  const out = [];
  if (facts.payment_to_personal_account) {
    out.push(flag('personal_payment', SEVERITY.HIGH,
      'Money is requested to a personal account, wallet or agent instead of the licensed agency.',
      'इजाजतप्राप्त संस्थाको सट्टा व्यक्तिगत खाता, वालेट वा एजेन्टलाई पैसा मागिएको छ।', null));
  }
  if (facts.asks_passport_early) {
    out.push(flag('passport_early', SEVERITY.MEDIUM,
      'They want your passport or original documents before any contract or approval.',
      'सम्झौता वा स्वीकृति हुनु अघि नै राहदानी वा सक्कल कागज मागिएको छ।', null));
  }
  if (facts.pressure_tactics) {
    out.push(flag('pressure', SEVERITY.MEDIUM,
      'Pressure to decide or pay fast ("only today", "seats filling").',
      'छिटो निर्णय वा भुक्तानी गर्न दबाब दिइएको छ।', null));
  }
  if (facts.asks_irrelevant_personal_info) {
    out.push(flag('irrelevant_questions', SEVERITY.LOW,
      'They ask about religion, family or habits, which a real employer does not need.',
      'धर्म, परिवार वा बानीबारे सोधिएको छ, जुन वास्तविक रोजगारदातालाई चाहिँदैन।', null));
  }
  return out;
}

function fingerprintFlags(priors) {
  const hot = (priors ?? []).filter((p) => p.highRisk > 0);
  if (hot.length === 0) return [];
  const reports = hot.reduce((n, p) => n + p.highRisk, 0);
  const origins = [...new Set(hot.flatMap((p) => Object.keys(p.origins ?? {})))];
  const names = origins.map((c) => PACKS[c]?.name ?? c).join(', ');
  const namesNp = origins.map((c) => PACKS[c]?.name_np ?? c).join(', ');
  return [flag('recruiter_reported', SEVERITY.HIGH,
    `This recruiter's contact (${hot.map((p) => p.hint).join(', ')}) was already reported in ${reports} high-risk check(s) by workers from ${names}.`,
    `यो एजेन्टको सम्पर्क (${hot.map((p) => p.hint).join(', ')}) पहिले नै ${namesNp}का कामदारहरूको ${reports} उच्च जोखिम जाँचमा देखिएको छ।`, null)];
}

/**
 * @param {object} facts   structured facts from Gemini
 * @param {{agency?: object, fraudMatches?: object[], fingerprints?: object[]}} lookups
 * @param {object} [pack]  origin-country pack (defaults to Nepal)
 */
export function evaluate(facts = {}, lookups = {}, pack = PACKS.NP) {
  const country = normalizeCountry(facts.destination_country);
  const flags = [];

  if (facts.visa_type === 'visit' || facts.visa_type === 'tourist') {
    flags.push(flag('visit_visa', SEVERITY.HIGH,
      `You are being sent on a visit/tourist visa. Work abroad needs a work visa and a ${pack.exit_permit}; without them you have no insurance or legal protection.`,
      `तपाईंलाई भिजिट/टुरिस्ट भिसामा पठाउन खोजिएको छ। कामका लागि यो मान्य छैन: ${pack.exit_permit_np}, बीमा र कानुनी सुरक्षा हुँदैन।`,
      RULES.visit_visa.sources[0]));
  }
  if (facts.no_labour_permit === true) {
    flags.push(flag('no_labour_permit', SEVERITY.HIGH,
      `The offer skips the ${pack.exit_permit}. Without it you are not protected abroad.`,
      `यो प्रस्तावमा ${pack.exit_permit_np} छैन। यसबिना विदेशमा तपाईं सुरक्षित हुनुहुन्न।`, pack.registry_url));
  }

  flags.push(...fingerprintFlags(lookups.fingerprints));
  flags.push(...agencyFlags(lookups.agency, pack));

  for (const match of lookups.fraudMatches ?? []) {
    flags.push(flag('fraud_list_match', SEVERITY.HIGH,
      `"${match.name}" appears in a public notice of people accused of foreign-employment fraud (${match.notice_ref}). Names can be shared, so confirm before acting.`,
      `"${match.name}" वैदेशिक रोजगार ठगीको आरोप लागेकाहरूको सार्वजनिक सूचनामा छ (${match.notice_ref})। नाम मिल्न सक्छ, पक्का गर्नुहोस्।`,
      match.source ?? RULES.official_channels.dofe));
  }

  flags.push(...feeFlags(facts, country, pack));
  flags.push(...sectorFlags(facts, country));
  flags.push(...behaviourFlags(facts));

  const has = (sev) => flags.some((f) => f.severity === sev);
  const risk = has(SEVERITY.HIGH) ? SEVERITY.HIGH : has(SEVERITY.MEDIUM) ? SEVERITY.MEDIUM : SEVERITY.LOW;

  return { risk, country, flags };
}

export const officialChannels = RULES.official_channels;
export const feeRules = RULES.free_visa_free_ticket;
