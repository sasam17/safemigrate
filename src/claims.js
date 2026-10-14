// Claim-by-claim verification: every checkable statement in the offer gets
// GREEN (checked and fine), AMBER (cannot be checked online - here is the
// offline step) or RED (checked and failed). Never says an offer is "safe".
import { feeRules } from './rules.js';

const STATUS = Object.freeze({ RED: 'red', AMBER: 'amber', GREEN: 'green' });

function claim(id, status, value, detail, next = {}, source = null, checkedAt = null) {
  return {
    id,
    status,
    value: value ?? '',
    detail_en: detail.en,
    detail_np: detail.np,
    next_en: next.en ?? null,
    next_np: next.np ?? null,
    source,
    checked_at: checkedAt,
  };
}

// Compare by the last 9 digits so "+977 98…" and "98…" match.
const tail = (p) => String(p ?? '').replace(/\D/g, '').slice(-9);

/** Is any recruiter number one of the agency's registered numbers? null = nothing to compare. */
export function contactMatchesAgency(recruiterPhones, agencyPhones) {
  const official = new Set((agencyPhones ?? []).map(tail).filter((t) => t.length >= 7));
  const used = (recruiterPhones ?? []).map(tail).filter((t) => t.length >= 7);
  if (official.size === 0 || used.length === 0) return null;
  return used.some((t) => official.has(t));
}

function agencyClaim(facts, agency, pack, meta) {
  const value = [facts.agency_name, facts.agency_license_no && `#${facts.agency_license_no}`].filter(Boolean).join(' ');
  const src = pack.registry_url;
  const at = meta?.fetchedAt ?? null;
  const askAgency = {
    en: `Ask for the agency's full name and licence number, then search it in the ${pack.registry_name}.`,
    np: 'म्यानपावर कम्पनीको पूरा नाम र इजाजत नम्बर माग्नुहोस्, अनि सरकारी सूचीमा खोज्नुहोस्।',
  };
  switch (agency?.status) {
    case 'found':
      if (agency.agency?.active === false) {
        return claim('agency', STATUS.RED, value,
          { en: `Listed, but licence status is "${agency.agency.status}".`, np: `सूचीमा छ, तर इजाजत "${agency.agency.status}" छ।` },
          { en: 'Do not pay an agency without a valid licence.', np: 'मान्य इजाजत नभएको संस्थालाई पैसा नतिर्नुहोस्।' }, src, at);
      }
      if (contactMatchesAgency(facts.recruiter_phones, agency.agency.phones) === false) {
        const official = agency.agency.phones.join(', ');
        return claim('agency', STATUS.AMBER, value,
          { en: `${agency.agency.name} is licensed, but the number contacting you is not one of its registered numbers. Scammers often pretend to be real agencies.`,
            np: `${agency.agency.name} इजाजतप्राप्त छ, तर तपाईंलाई सम्पर्क गर्ने नम्बर यसको दर्ता भएको नम्बर होइन। ठगहरू असली कम्पनी भएको बहाना गर्छन्।` },
          { en: `Call the agency's registered number (${official}) and ask if this offer is theirs.`, np: `कम्पनीको दर्ता भएको नम्बरमा (${official}) फोन गरेर यो प्रस्ताव उनीहरूकै हो कि सोध्नुहोस्।` }, src, at);
      }
      return claim('agency', STATUS.GREEN, value,
        { en: `Found in the ${pack.registry_name}: ${agency.agency.name}${agency.agency.license_no ? ` (#${agency.agency.license_no})` : ''}, status ${agency.agency.status ?? 'listed'}.`,
          np: `सरकारी सूचीमा भेटियो: ${agency.agency.name}${agency.agency.license_no ? ` (#${agency.agency.license_no})` : ''}।` },
        { en: 'Scammers copy real agency names. Call the number listed in the registry, not the one in the chat.', np: 'ठगहरूले असली कम्पनीको नाम चोर्छन्। च्याटको नम्बर होइन, सूचीमा भएको नम्बरमा फोन गर्नुहोस्।' }, src, at);
    case 'not_found':
      return claim('agency', STATUS.RED, value,
        { en: `Not found in the ${pack.registry_name}.`, np: 'सरकारी इजाजतप्राप्त सूचीमा भेटिएन।' }, askAgency, src, at);
    case 'unavailable':
      return claim('agency', STATUS.AMBER, value,
        { en: 'The registry could not be reached, so this was not checked.', np: 'सूची जाँच गर्न सकिएन।' }, askAgency, src, at);
    default:
      return claim('agency', STATUS.AMBER, '—',
        { en: 'No agency is named in the offer.', np: 'प्रस्तावमा कुनै म्यानपावरको नाम छैन।' }, askAgency, src, at);
  }
}

function visaClaim(facts, pack) {
  const v = facts.visa_type ?? 'unknown';
  if (v === 'visit' || v === 'tourist') {
    return claim('visa', STATUS.RED, v,
      { en: 'A visit/tourist visa is not a work visa. Working on it means no permit, insurance or legal protection.', np: 'भिजिट/टुरिस्ट भिसा कामको भिसा होइन। यसमा काम गर्दा स्वीकृति, बीमा र कानुनी सुरक्षा हुँदैन।' },
      { en: `Refuse to travel without a work visa and ${pack.exit_permit}.`, np: `कामको भिसा र ${pack.exit_permit_np} बिना नजानुहोस्।` });
  }
  if (v === 'work') {
    return claim('visa', STATUS.GREEN, v,
      { en: 'The offer says it is a work visa.', np: 'प्रस्तावमा कामको भिसा भनिएको छ।' },
      { en: 'Get a copy of the visa before paying and check the visa type printed on it.', np: 'पैसा तिर्नु अघि भिसाको प्रतिलिपि लिनुहोस् र भिसाको प्रकार हेर्नुहोस्।' });
  }
  return claim('visa', STATUS.AMBER, v,
    { en: 'The visa type is not stated.', np: 'भिसाको प्रकार उल्लेख छैन।' },
    { en: 'Ask in writing: "Is this a work visa?" A tourist visa for work is a trap.', np: 'लिखितमा सोध्नुहोस्: "यो कामको भिसा हो?" कामका लागि टुरिस्ट भिसा जाल हो।' });
}

function permitClaim(facts, pack) {
  if (facts.no_labour_permit) {
    return claim('permit', STATUS.RED, pack.exit_permit,
      { en: `The offer skips the ${pack.exit_permit}.`, np: `यो प्रस्तावमा ${pack.exit_permit_np} छैन।` },
      { en: 'Never leave without it; it is your insurance and legal protection.', np: 'यो बिना कहिल्यै नजानुहोस्; यही तपाईंको बीमा र कानुनी सुरक्षा हो।' }, pack.registry_url);
  }
  // Where the regulator publishes approved job orders (Philippines), point there.
  if (pack.job_orders_url) {
    return claim('permit', STATUS.AMBER, pack.exit_permit,
      { en: `Check that this exact job appears in the ${pack.regulator} list of approved job orders.`, np: 'यो काम सरकारले स्वीकृत गरेको जागिर सूचीमा छ कि छैन जाँच्नुहोस्।' },
      { en: `Search the employer and position in the approved job orders, then get your ${pack.exit_permit} before travel.`, np: `स्वीकृत जागिर सूचीमा रोजगारदाता र पद खोज्नुहोस्, अनि जानु अघि ${pack.exit_permit_np} लिनुहोस्।` },
      pack.job_orders_url);
  }
  // The permit / demand approval database is not public, so this is always amber.
  return claim('permit', STATUS.AMBER, pack.exit_permit,
    { en: `The ${pack.regulator} approval of this job cannot be checked online.`, np: 'यो कामको सरकारी स्वीकृति अनलाइन जाँच गर्न सकिँदैन।' },
    { en: `Ask the agency for the approval (demand) number and confirm it at the ${pack.regulator} before paying.`, np: 'म्यानपावरसँग स्वीकृति (डिमान्ड) नम्बर माग्नुहोस् र पैसा तिर्नु अघि विभागमा पक्का गर्नुहोस्।' }, pack.registry_url);
}

function feeClaim(facts, flags) {
  const over = flags.find((f) => f.id === 'fee_over_cap');
  const fee = Number(facts.fee_demanded_npr ?? facts.fee_amount);
  if (over) {
    return claim('fee', STATUS.RED, `NPR ${fee.toLocaleString('en-IN')}`,
      { en: over.title_en, np: over.title_np },
      { en: 'Do not pay more than the legal cap; ask for the official receipt.', np: 'कानुनी सीमाभन्दा बढी नतिर्नुहोस्; आधिकारिक रसिद माग्नुहोस्।' }, over.source);
  }
  if (Number.isFinite(fee) && fee > 0) {
    const capped = !flags.some((f) => f.id === 'fee_demanded');
    return claim('fee', capped ? STATUS.GREEN : STATUS.AMBER, fee.toLocaleString('en-IN'),
      capped
        ? { en: `Within the NPR ${feeRules.max_service_charge_npr.toLocaleString('en-IN')} service-charge cap.`, np: 'सेवा शुल्क सीमाभित्र छ।' }
        : { en: 'There is no fixed legal cap for this route in our data.', np: 'यो मार्गका लागि हाम्रो डाटामा तोकिएको सीमा छैन।' },
      { en: "Pay only to the agency's bank account and keep the receipt.", np: 'म्यानपावरको बैंक खातामा मात्र तिर्नुहोस् र रसिद राख्नुहोस्।' },
      capped ? feeRules.sources[0] : null);
  }
  return claim('fee', STATUS.AMBER, '—',
    { en: 'No fee is stated.', np: 'शुल्क उल्लेख छैन।' },
    { en: 'Ask in writing exactly how much you must pay, and to whom.', np: 'कति र कसलाई तिर्नुपर्छ लिखितमा सोध्नुहोस्।' });
}

function jobClaim(facts, flags) {
  const scam = flags.find((f) => f.id === 'scam_centre_pattern');
  const value = [facts.job_title, facts.employer_name, facts.destination_country].filter(Boolean).join(' · ');
  if (scam) {
    return claim('job', STATUS.RED, value, { en: scam.title_en, np: scam.title_np },
      { en: 'Do not travel. Share this with family and report it.', np: 'नजानुहोस्। परिवारलाई देखाउनुहोस् र उजुरी गर्नुहोस्।' });
  }
  return claim('job', STATUS.AMBER, value || '—',
    { en: 'The employer abroad cannot be verified online.', np: 'विदेशको रोजगारदाता अनलाइन जाँच गर्न सकिँदैन।' },
    { en: 'Ask for the employment contract and the embassy-attested demand letter.', np: 'रोजगार सम्झौता र दूतावासबाट प्रमाणित डिमान्ड लेटर माग्नुहोस्।' });
}

function recruiterClaim(prints, priors) {
  if (prints.length === 0) return null;
  const hot = priors.filter((p) => p.highRisk > 0);
  const value = prints.map((p) => p.hint).join(', ');
  if (hot.length) {
    const reports = hot.reduce((n, p) => n + p.highRisk, 0);
    const origins = [...new Set(hot.flatMap((p) => Object.keys(p.origins ?? {})))].join(', ');
    return claim('recruiter', STATUS.RED, value,
      { en: `Reported before in ${reports} high-risk check(s) (origin: ${origins}).`, np: `पहिले ${reports} उच्च जोखिम जाँचमा देखिएको (${origins})।` },
      { en: 'Stop contact and report this number.', np: 'सम्पर्क रोक्नुहोस् र यो नम्बरको उजुरी गर्नुहोस्।' });
  }
  return claim('recruiter', STATUS.AMBER, value,
    { en: 'No earlier reports for these contacts. That is not proof they are safe.', np: 'यी सम्पर्कबारे पहिलेको उजुरी छैन। यसको अर्थ सुरक्षित हो भन्ने होइन।' },
    { en: "Talk to the agency's office in person, not only on WhatsApp.", np: 'WhatsApp मात्र होइन, म्यानपावरको कार्यालयमा गएर कुरा गर्नुहोस्।' });
}

function paymentClaim(facts) {
  if (!facts.payment_to_personal_account) return null;
  return claim('payment', STATUS.RED, '',
    { en: 'Money is requested to a personal account or wallet.', np: 'व्यक्तिगत खाता वा वालेटमा पैसा मागिएको छ।' },
    { en: "Never pay a person's account or wallet.", np: 'कुनै व्यक्तिको खाता वा वालेटमा कहिल्यै नतिर्नुहोस्।' });
}

/**
 * @param {object} facts
 * @param {{agency?: object, flags: object[], prints?: object[], priors?: object[], registryMeta?: object}} ctx
 * @param {object} pack
 */
export function buildClaims(facts, ctx, pack) {
  return [
    agencyClaim(facts, ctx.agency, pack, ctx.registryMeta),
    visaClaim(facts, pack),
    permitClaim(facts, pack),
    feeClaim(facts, ctx.flags),
    jobClaim(facts, ctx.flags),
    recruiterClaim(ctx.prints ?? [], ctx.priors ?? []),
    paymentClaim(facts),
  ].filter(Boolean);
}
