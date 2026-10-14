import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, normalizeCountry } from '../src/rules.js';

const ids = (r) => r.flags.map((f) => f.id);
const licensed = { status: 'found', agency: { name: 'Example Overseas', active: true, status: 'Active' } };

test('normalizes Gulf city names to countries', () => {
  assert.equal(normalizeCountry('Dubai'), 'United Arab Emirates');
  assert.equal(normalizeCountry(' KSA '), 'Saudi Arabia');
  assert.equal(normalizeCountry('Japan'), 'Japan');
  assert.equal(normalizeCountry(null), null);
});

test('visit visa iGaming offer (the Big Wave pattern) is high risk', () => {
  const r = evaluate(
    { destination_country: 'Dubai', visa_type: 'visit', job_title: 'Customer service', sector_keywords: ['iGaming'], asks_irrelevant_personal_info: true },
    { agency: { status: 'not_mentioned' } },
  );
  assert.equal(r.risk, 'high');
  assert.ok(ids(r).includes('visit_visa'));
  assert.ok(ids(r).includes('scam_centre_pattern'));
  assert.ok(ids(r).includes('irrelevant_questions'));
});

test('fee above NPR 10,000 for a free-visa-free-ticket country is high risk', () => {
  const r = evaluate({ destination_country: 'Qatar', visa_type: 'work', fee_demanded_npr: 150000 }, { agency: licensed });
  assert.equal(r.risk, 'high');
  assert.ok(ids(r).includes('fee_over_cap'));
});

test('fee for a non-capped country is only a low reminder', () => {
  const r = evaluate({ destination_country: 'Japan', visa_type: 'work', fee_demanded_npr: 80000 }, { agency: licensed });
  assert.equal(r.risk, 'low');
  assert.deepEqual(ids(r), ['fee_demanded']);
});

test('clean offer through a licensed agency raises no flags', () => {
  const r = evaluate({ destination_country: 'Malaysia', visa_type: 'work', fee_demanded_npr: 10000 }, { agency: licensed });
  assert.equal(r.risk, 'low');
  assert.equal(r.flags.length, 0);
});

test('unlicensed or inactive agency is high risk', () => {
  assert.equal(evaluate({}, { agency: { status: 'not_found', query: 'Fake Manpower' } }).risk, 'high');
  const inactive = { status: 'found', agency: { name: 'X', active: false, status: 'Cancelled' } };
  assert.ok(ids(evaluate({}, { agency: inactive })).includes('agency_inactive'));
});

test('registry outage never claims an agency is unlicensed', () => {
  const r = evaluate({ visa_type: 'work' }, { agency: { status: 'unavailable', query: 'Some Agency' } });
  assert.deepEqual(ids(r), ['agency_unverified']);
  assert.equal(r.risk, 'low');
});

test('fraud-list match and personal-account payment are high risk', () => {
  const r = evaluate(
    { payment_to_personal_account: true },
    { agency: licensed, fraudMatches: [{ name: 'Ram Bahadur', notice_ref: 'DoFE notice 2083-06' }] },
  );
  assert.equal(r.risk, 'high');
  assert.ok(ids(r).includes('fraud_list_match'));
  assert.ok(ids(r).includes('personal_payment'));
});

test('every flag carries Nepali and English text', () => {
  const r = evaluate(
    { visa_type: 'visit', no_labour_permit: true, fee_demanded_npr: 50000, destination_country: 'Oman', asks_passport_early: true, pressure_tactics: true },
    { agency: { status: 'not_mentioned' } },
  );
  for (const f of r.flags) {
    assert.ok(f.title_en.length > 10, f.id);
    assert.ok(/[ऀ-ॿ]/.test(f.title_np), `${f.id} has Devanagari`);
  }
});
