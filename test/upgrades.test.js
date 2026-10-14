import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContact, fingerprintsFrom, mergeReport, lookupFingerprints, recordFingerprints } from '../src/fingerprint.js';
import { buildClaims, contactMatchesAgency } from '../src/claims.js';
import { evaluate, getPack } from '../src/rules.js';
import { findAgency, findPeople, similarity } from '../src/match.js';

const NP = getPack('NP');
const PK = getPack('PK');

test('phone numbers normalise across formats', () => {
  assert.deepEqual(normalizeContact('phone', '+971 50 123 4567'), { kind: 'phone', key: '971501234567' });
  assert.deepEqual(normalizeContact('phone', '00971-50-1234567'), { kind: 'phone', key: '971501234567' });
  assert.equal(normalizeContact('phone', '123'), null);
  assert.equal(normalizeContact('facebook', 'https://www.facebook.com/BigWaveJobs?ref=x').key, 'bigwavejobs');
});

test('fingerprints never contain the raw contact and dedupe the same number', () => {
  const prints = fingerprintsFrom({ recruiter_phones: ['+971 50 123 4567', '00971501234567'] });
  assert.equal(prints.length, 1);
  assert.match(prints[0].id, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(prints).includes('501234'));
  assert.equal(prints[0].hint, 'phone:…567');
});

test('mergeReport counts reports, origins and keeps firstSeen', () => {
  const a = mergeReport(null, { kind: 'phone', risk: 'high', origin: 'NP', destination: 'United Arab Emirates', now: 't1' });
  const b = mergeReport(a, { kind: 'phone', risk: 'medium', origin: 'PK', destination: 'United Arab Emirates', now: 't2' });
  assert.equal(b.reports, 2);
  assert.equal(b.highRisk, 1);
  assert.deepEqual(b.origins, { NP: 1, PK: 1 });
  assert.equal(b.destinations['United Arab Emirates'], 2);
  assert.equal(b.firstSeen, 't1');
  assert.equal(b.lastSeen, 't2');
});

test('a recruiter reported from Nepal is flagged for a worker in Pakistan', async () => {
  const prints = fingerprintsFrom({ recruiter_phones: ['+971 55 999 0001'] });
  await recordFingerprints(prints, { risk: 'high', origin: 'NP', destination: 'United Arab Emirates' });
  const priors = await lookupFingerprints(prints);
  const r = evaluate({ visa_type: 'work' }, { agency: { status: 'not_mentioned' }, fingerprints: priors }, PK);
  assert.equal(r.risk, 'high');
  const f = r.flags.find((x) => x.id === 'recruiter_reported');
  assert.ok(f.title_en.includes('Nepal'));
});

test('low-risk checks are not recorded in the network', async () => {
  const prints = fingerprintsFrom({ recruiter_phones: ['+977 9800000099'] });
  await recordFingerprints(prints, { risk: 'low', origin: 'NP' });
  assert.equal((await lookupFingerprints(prints)).length, 0);
});

test('claims: visit-visa scam offer is red on visa and job, amber where unverifiable', () => {
  const facts = { visa_type: 'visit', job_title: 'Customer service', sector_keywords: ['iGaming'], destination_country: 'Dubai' };
  const verdict = evaluate(facts, { agency: { status: 'not_mentioned' } }, NP);
  const claims = buildClaims(facts, { agency: { status: 'not_mentioned' }, flags: verdict.flags }, NP);
  const byId = Object.fromEntries(claims.map((c) => [c.id, c.status]));
  assert.equal(byId.visa, 'red');
  assert.equal(byId.job, 'red');
  assert.equal(byId.agency, 'amber');
  assert.equal(byId.permit, 'amber');
});

test('claims never mark the permit green: approval cannot be checked online', () => {
  const facts = { visa_type: 'work', destination_country: 'Qatar', fee_demanded_npr: 10000 };
  const agency = { status: 'found', agency: { name: 'Good Overseas', license_no: '123', active: true, status: 'Valid' } };
  const verdict = evaluate(facts, { agency }, NP);
  const claims = buildClaims(facts, { agency, flags: verdict.flags, registryMeta: { fetchedAt: '2026-10-14' } }, NP);
  const byId = Object.fromEntries(claims.map((c) => [c.id, c]));
  assert.equal(byId.agency.status, 'green');
  assert.equal(byId.agency.checked_at, '2026-10-14');
  assert.equal(byId.fee.status, 'green');
  assert.equal(byId.permit.status, 'amber');
  assert.ok(claims.every((c) => c.next_en && c.next_np));
});

test('every claim has English and Nepali detail text', () => {
  const facts = { visa_type: 'unknown', payment_to_personal_account: true, recruiter_phones: ['+923001234567'] };
  const verdict = evaluate(facts, {}, PK);
  const claims = buildClaims(facts, { flags: verdict.flags, prints: fingerprintsFrom(facts), priors: [] }, PK);
  for (const c of claims) {
    assert.ok(c.detail_en.length > 5, c.id);
    assert.ok(/[ऀ-ॿ]/.test(c.detail_np), c.id);
  }
});

test('agency matching ignores Pvt Ltd noise and matches licence numbers', () => {
  const list = [{ name: 'Himalayan Overseas Pvt. Ltd.', license_no: '0456/KTM' }, { name: 'Gulf Star Manpower', license_no: '789' }];
  assert.equal(findAgency({ name: 'Himalayan Overseas Private Limited' }, list).agency.license_no, '0456/KTM');
  assert.equal(findAgency({ license_no: '0456' }, list).by, 'license');
  assert.equal(findAgency({ name: 'Totally Different Agency' }, list), null);
  assert.ok(similarity('Gulf Star', 'Gulf Star Manpower') > 0.5);
});

test('official-number check: same number in any format matches', () => {
  assert.equal(contactMatchesAgency(['+977 98-0000-1234'], ['9800001234']), true);
  assert.equal(contactMatchesAgency(['+971 50 111 2222'], ['9800001234']), false);
  assert.equal(contactMatchesAgency([], ['9800001234']), null);
  assert.equal(contactMatchesAgency(['9800001234'], []), null);
});

test('licensed agency contacted from an unregistered number turns amber (impersonation)', () => {
  const agency = { status: 'found', agency: { name: 'Real Overseas', license_no: '500', active: true, status: 'Active', phones: ['014400000', '9800001234'] } };
  const facts = { visa_type: 'work', recruiter_phones: ['+971 50 111 2222'] };
  const verdict = evaluate(facts, { agency }, NP);
  const claims = buildClaims(facts, { agency, flags: verdict.flags }, NP);
  const a = claims.find((c) => c.id === 'agency');
  assert.equal(a.status, 'amber');
  assert.ok(a.next_en.includes('9800001234'));
});

test('placeholder values like "unknown" are treated as empty, never as an agency name', async () => {
  const { sanitizeFacts } = await import('../src/agent.js');
  const f = sanitizeFacts({ agency_name: 'unknown', employer_name: 'Not mentioned', visa_type: 'unknown', recruiter_names: ['N/A', 'Asma'], fee_amount: 0 });
  assert.equal(f.agency_name, '');
  assert.equal(f.employer_name, '');
  assert.equal(f.visa_type, 'unknown');
  assert.deepEqual(f.recruiter_names, ['Asma']);
  assert.equal(f.fee_amount, 0);
});

test('telegram report shows stamp, cross-border warning and next steps in Nepali', async () => {
  const { formatReport } = await import('../src/telegram.js');
  const facts = { visa_type: 'visit', job_title: 'iGaming support', sector_keywords: ['iGaming'], destination_country: 'Dubai', summary_np: 'सारांश', summary_en: 'Summary' };
  const flags = evaluate(facts, { agency: { status: 'not_mentioned' }, fingerprints: [{ hint: 'phone:…123', highRisk: 1, origins: { PK: 1 } }] }, NP).flags;
  const claims = buildClaims(facts, { agency: { status: 'not_mentioned' }, flags }, NP);
  const text = formatReport({ risk: 'high', facts, flags, claims, origin: { complaint_url: 'https://ujuri.dofe.gov.np/' } }, 'ne');
  assert.ok(text.startsWith('🚨 उच्च जोखिम'));
  assert.ok(text.includes('🌏'));
  assert.ok(text.includes('🔴'));
  assert.ok(text.includes('→'));
  assert.ok(text.includes('ujuri.dofe.gov.np'));
});

test('verdict script reads the stamp, summary and red claims', async () => {
  const { verdictScript } = await import('../src/voice.js');
  const s = verdictScript({ risk: 'high', facts: { summary_np: 'यो जाल हो' }, claims: [{ status: 'red', detail_np: 'भिसा गलत' }, { status: 'amber', detail_np: 'नपढ्ने' }] }, 'ne');
  assert.ok(s.startsWith('उच्च जोखिम'));
  assert.ok(s.includes('भिसा गलत'));
  assert.ok(!s.includes('नपढ्ने'));
});

test('translations map back to summary, flags and claims by position', async () => {
  const { collectStrings, applyTranslations } = await import('../src/translate.js');
  const report = {
    facts: { summary_en: 'S' },
    flags: [{ title_en: 'F1' }, { title_en: 'F2' }],
    claims: [{ detail_en: 'D1', next_en: 'N1' }, { detail_en: 'D2', next_en: null }],
  };
  const strings = collectStrings(report);
  assert.deepEqual(strings, ['S', 'F1', 'F2', 'D1', 'N1', 'D2', '']);
  const out = applyTranslations(report, 'ur', strings.map((s) => (s ? `ur:${s}` : s)));
  assert.equal(out.i18n.summary, 'ur:S');
  assert.deepEqual(out.i18n.flags, ['ur:F1', 'ur:F2']);
  assert.deepEqual(out.i18n.claims[1], { detail: 'ur:D2', next: '' });
  assert.equal(out.facts.summary_en, 'S', 'original English kept for auditing');
});

test('voice script uses the translated text and Urdu labels', async () => {
  const { verdictScript } = await import('../src/voice.js');
  const report = {
    risk: 'high', facts: { summary_en: 'Scam' },
    claims: [{ status: 'red', detail_en: 'Visit visa' }],
    i18n: { lang: 'ur', summary: 'دھوکہ', claims: [{ detail: 'وزٹ ویزا' }] },
  };
  const s = verdictScript(report, 'ur');
  assert.ok(s.startsWith('زیادہ خطرہ'));
  assert.ok(s.includes('دھوکہ') && s.includes('وزٹ ویزا'));
  assert.ok(!s.includes('Scam'));
});

test('spending lock allows up to the daily limit and then refuses', async () => {
  const { allow, consume, todayKey } = await import('../src/budget.js');
  assert.equal(allow(1499, 1, 1500), true);
  assert.equal(allow(1500, 1, 1500), false);
  assert.equal(allow(1499, 2, 1500), false);
  assert.match(todayKey(new Date('2026-10-15T23:59:00Z')), /^2026-10-15$/);
  let granted = 0;
  for (let i = 0; i < 1600; i += 1) if (await consume('test')) granted += 1;
  assert.ok(granted <= 1500, `granted ${granted}`);
});

test('person matching needs every token of the listed name', () => {
  const list = [{ name: 'Ram Bahadur Thapa', notice_ref: 'n1' }];
  assert.equal(findPeople(['Ram'], list).length, 0);
  assert.equal(findPeople(['Mr Ram Bahadur Thapa'], list).length, 1);
});
