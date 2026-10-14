// SafeMigrate front end. Vanilla JS; all model output is rendered with
// textContent, never innerHTML.
(() => {
  const MAX_FILES = 4;
  const $ = (id) => document.getElementById(id);
  const state = { lang: localStorageGet('lang') || 'ne', files: [], report: null, map: null };

  const FLAG_LABELS = {
    visit_visa: ['भिजिट भिसा', 'Visit visa'],
    no_labour_permit: ['श्रम स्वीकृति छैन', 'No labour permit'],
    no_agency: ['म्यानपावर उल्लेख छैन', 'No agency named'],
    agency_not_licensed: ['इजाजत नभएको संस्था', 'Unlicensed agency'],
    agency_inactive: ['निष्क्रिय इजाजत', 'Inactive licence'],
    agency_unverified: ['जाँच हुन सकेन', 'Could not verify'],
    fraud_list_match: ['ठगी सूचीमा नाम', 'On fraud list'],
    fee_over_cap: ['बढी शुल्क', 'Fee over cap'],
    fee_demanded: ['शुल्क मागिएको', 'Fee demanded'],
    scam_centre_pattern: ['ठगी केन्द्र ढाँचा', 'Scam-centre pattern'],
    personal_payment: ['व्यक्तिगत खातामा पैसा', 'Pay to personal account'],
    passport_early: ['राहदानी चाँडै माग', 'Passport asked early'],
    pressure: ['दबाब', 'Pressure tactics'],
    irrelevant_questions: ['अनावश्यक प्रश्न', 'Irrelevant questions'],
  };

  // Approximate country centroids for the risk map.
  const CENTROIDS = {
    'United Arab Emirates': [24.0, 54.0], 'Saudi Arabia': [24.0, 45.0], Qatar: [25.3, 51.2],
    Kuwait: [29.3, 47.6], Bahrain: [26.0, 50.55], Oman: [21.0, 57.0], Malaysia: [3.5, 102.0],
    Japan: [36.0, 138.0], 'South Korea': [36.5, 127.8], Israel: [31.0, 35.0], Romania: [45.9, 24.9],
    Poland: [52.0, 19.0], Croatia: [45.1, 15.2], Portugal: [39.5, -8.0], Malta: [35.9, 14.4],
    Cyprus: [35.0, 33.0], Russia: [55.75, 37.6], Myanmar: [21.0, 96.0], Cambodia: [12.5, 105.0],
    Laos: [18.0, 103.0], Thailand: [15.0, 101.0], Maldives: [3.2, 73.2], Jordan: [31.0, 36.0],
    Turkey: [39.0, 35.0], Serbia: [44.0, 20.9], Hungary: [47.1, 19.5],
  };

  function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
  const t = (key) => (window.I18N[state.lang] || window.I18N.ne)[key] || key;
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  function applyI18n() {
    document.documentElement.lang = state.lang === 'ne' ? 'ne' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
    $('langBtn').textContent = state.lang === 'ne' ? 'EN' : 'नेपाली';
    if (state.report) renderReport(state.report);
  }

  // ---------- evidence ----------
  function addFiles(list) {
    for (const file of list) {
      if (state.files.length >= MAX_FILES) break;
      state.files.push({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    renderFiles();
  }

  function renderFiles() {
    const ul = $('fileList');
    ul.replaceChildren(...state.files.map((f, i) => {
      const remove = el('button', { type: 'button', textContent: '✕', ariaLabel: 'Remove' });
      remove.addEventListener('click', () => { state.files.splice(i, 1); renderFiles(); });
      const icon = f.url ? el('img', { src: f.url, alt: '' }) : el('span', { textContent: f.file.type.startsWith('audio/') ? '🎤' : '📄' });
      return el('li', {}, icon, el('span', { textContent: f.file.name.slice(0, 18) }), remove);
    }));
  }

  let recorder = null;
  async function toggleRecord() {
    const btn = $('recBtn');
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        btn.classList.remove('recording');
        btn.querySelector('span:last-child').textContent = t('record');
        const type = recorder.mimeType.split(';')[0] || 'audio/webm';
        addFiles([new File([new Blob(chunks, { type })], `voice-${Date.now()}.${type.split('/')[1]}`, { type })]);
      };
      recorder.start();
      btn.classList.add('recording');
      btn.querySelector('span:last-child').textContent = t('stopRecord');
    } catch {
      showError(t('errMic'));
    }
  }

  // ---------- check ----------
  function showError(msg) { const e = $('formError'); e.textContent = msg; e.hidden = !msg; }

  function runProgress() {
    const steps = [...document.querySelectorAll('#progress li')];
    steps.forEach((s) => s.classList.remove('active', 'done'));
    $('progress').hidden = false;
    let i = 0;
    steps[0].classList.add('active');
    const timer = setInterval(() => {
      if (i < steps.length - 1) {
        steps[i].classList.replace('active', 'done');
        i += 1;
        steps[i].classList.add('active');
      }
    }, 2200);
    return () => { clearInterval(timer); steps.forEach((s) => { s.classList.remove('active'); s.classList.add('done'); }); };
  }

  async function check() {
    const text = $('textInput').value.trim();
    if (!text && state.files.length === 0) { showError(t('errEmpty')); return; }
    showError('');
    const btn = $('checkBtn');
    btn.disabled = true;
    btn.textContent = t('checking');
    $('result').hidden = true;
    const finish = runProgress();
    const body = new FormData();
    body.append('text', text);
    body.append('origin', $('originSel').value);
    state.files.forEach((f) => body.append('files', f.file));
    try {
      const res = await fetch('/api/check', { method: 'POST', body });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      finish();
      state.report = json.data;
      renderReport(state.report);
    } catch (err) {
      $('progress').hidden = true;
      showError(err.message || 'Error');
    } finally {
      btn.disabled = false;
      btn.textContent = t('checkNow');
    }
  }

  function renderReport(r) {
    const np = state.lang === 'ne';
    const flags = r.flags.length
      ? el('ul', { className: 'flags' }, ...r.flags.map((f) => el('li', { className: f.severity },
          el('div', { textContent: np ? f.title_np : f.title_en }),
          f.source ? el('a', { href: f.source, target: '_blank', rel: 'noopener', textContent: `${t('source')} ↗` }) : null)))
      : el('p', { textContent: t('noFlags') });

    const agencyOk = r.agency?.status === 'found' && r.agency.agency?.active !== false
      ? el('p', { className: 'muted', textContent: `✅ ${t('agencyFound')}: ${r.agency.agency.name}${r.agency.agency.license_no ? ` (#${r.agency.agency.license_no})` : ''}` })
      : null;

    const quotes = (r.facts.evidence_quotes ?? []).length
      ? el('details', { className: 'trace' }, el('summary', { textContent: t('quotes') }),
          el('ul', { className: 'quotes' }, ...r.facts.evidence_quotes.map((q) => el('li', { textContent: `“${q}”` }))))
      : null;

    const trace = el('details', { className: 'trace' }, el('summary', { textContent: `${t('whatWeChecked')} (${r.trace.length})` }),
      el('ol', {}, ...r.trace.map((s) => el('li', {},
        el('code', { textContent: s.tool }), ' ',
        el('span', { textContent: JSON.stringify(s.args) }), ' → ',
        el('b', { textContent: summarizeTool(s) })))),
      el('p', { className: 'muted', textContent: `Model: ${r.model}` }));

    const listen = el('button', { className: 'secondary', type: 'button', textContent: t('listen') });
    listen.addEventListener('click', () => speak(r));
    const complain = el('button', { className: 'secondary', type: 'button', textContent: t('complaint') });
    complain.addEventListener('click', () => draftComplaint(r, complain));

    const crossBorder = r.flags.find((f) => f.id === 'recruiter_reported');
    const banner = crossBorder
      ? el('div', { className: 'banner' }, el('b', { textContent: `🌏 ${t('crossBorder')}` }),
          el('div', { textContent: np ? crossBorder.title_np : crossBorder.title_en }))
      : null;

    const claims = (r.claims ?? []).length
      ? el('div', { className: 'claims' }, el('h3', { textContent: t('claimsTitle') }),
          ...r.claims.map((c) => el('div', { className: `claim ${c.status}` },
            el('div', { className: 'claim-head' },
              el('span', { className: `badge ${c.status}`, textContent: t(`st_${c.status}`) }),
              el('b', { textContent: t(`claim_${c.id}`) }),
              c.value ? el('span', { className: 'muted', textContent: ` · ${c.value}` }) : null),
            el('div', { textContent: np ? c.detail_np : c.detail_en }),
            c.next_en ? el('div', { className: 'next', textContent: `→ ${np ? c.next_np : c.next_en}` }) : null,
            (c.source || c.checked_at) ? el('div', { className: 'meta' },
              c.source ? el('a', { href: c.source, target: '_blank', rel: 'noopener', textContent: `${t('source')} ↗` }) : null,
              c.checked_at ? el('span', { textContent: ` ${t('checkedOn')}: ${c.checked_at.slice(0, 10)}` }) : null) : null)))
      : null;

    const card = el('div', { className: `card verdict ${r.risk}` },
      el('div', { className: `stamp risk-${r.risk}`, textContent: t(`risk${r.risk}`) }),
      el('p', { className: 'summary', textContent: np ? r.facts.summary_np : r.facts.summary_en }),
      banner,
      agencyOk,
      claims,
      el('h3', { textContent: t('whatWeFound') }),
      flags,
      el('div', { className: 'actions' }, listen, complain),
      quotes,
      trace,
      el('div', { id: 'complaintBox' }));
    $('result').replaceChildren(card);
    $('result').hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function summarizeTool(step) {
    const r = step.result || {};
    if (step.tool === 'lookup_agency') return r.status === 'found' ? `found: ${r.agency?.name}` : r.status;
    if (step.tool === 'check_fraud_list') return `${(r.matches || []).length} match(es)`;
    return 'done';
  }

  function speak(r) {
    if (!('speechSynthesis' in window)) return;
    const np = state.lang === 'ne';
    const lines = [t(`risk${r.risk}`), np ? r.facts.summary_np : r.facts.summary_en, ...r.flags.map((f) => (np ? f.title_np : f.title_en))];
    const u = new SpeechSynthesisUtterance(lines.join('। '));
    const voices = speechSynthesis.getVoices();
    const pick = np
      ? voices.find((v) => v.lang.startsWith('ne')) || voices.find((v) => v.lang.startsWith('hi'))
      : voices.find((v) => v.lang.startsWith('en'));
    if (pick) { u.voice = pick; u.lang = pick.lang; } else { u.lang = np ? 'ne-NP' : 'en-US'; }
    u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  async function draftComplaint(report, btn) {
    btn.disabled = true;
    try {
      const res = await fetch('/api/complaint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const area = el('textarea', { value: json.data.text, readOnly: true });
      const copy = el('button', { className: 'secondary', type: 'button', textContent: t('copy') });
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(area.value); copy.textContent = t('copied'); } catch { area.select(); }
      });
      const open = el('a', { className: 'secondary', href: report.origin?.complaint_url || 'https://ujuri.dofe.gov.np/', target: '_blank', rel: 'noopener', textContent: `${t('openUjuri')} ↗` });
      $('complaintBox').replaceChildren(el('div', { className: 'complaint' }, area, el('div', { className: 'actions' }, copy, open)));
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- map ----------
  async function loadMap() {
    const json = await (await fetch('/api/stats')).json();
    if (!json.success) return;
    const s = json.data;
    $('stats').replaceChildren(
      ...[[s.total, 'statTotal'], [s.high, 'statHigh'], [s.countries.length, 'statCountries']]
        .map(([n, k]) => el('div', { className: 'stat' }, el('b', { textContent: String(n) }), el('span', { textContent: t(k) }))));

    if (!state.map) {
      state.map = L.map('map', { scrollWheelZoom: false }).setView([22, 75], 3);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 6, attribution: '© OpenStreetMap',
      }).addTo(state.map);
    }
    setTimeout(() => state.map.invalidateSize(), 50);
    state.map.eachLayer((layer) => { if (layer instanceof L.CircleMarker) state.map.removeLayer(layer); });
    for (const c of s.countries) {
      const at = CENTROIDS[c.country];
      if (!at) continue;
      const share = c.total ? c.high / c.total : 0;
      L.circleMarker(at, {
        radius: 8 + Math.sqrt(c.total) * 5,
        color: share > 0.5 ? '#c8102e' : share > 0 ? '#b45309' : '#17803d',
        fillOpacity: 0.45, weight: 2,
      }).bindTooltip(`${c.country}: ${c.total} (${c.high} high)`).addTo(state.map);
    }

    const entries = Object.entries(s.flags).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = entries[0]?.[1] || 1;
    $('flagBars').replaceChildren(...entries.map(([id, n]) => el('div', { className: 'bar' },
      el('span', { textContent: (FLAG_LABELS[id] || [id, id])[state.lang === 'ne' ? 0 : 1] }),
      el('span', { className: 'track' }, el('span', { className: 'fill', style: `width:${(n / max) * 100}%` })),
      el('b', { textContent: String(n) }))));
  }

  function showView(name) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('view-check').hidden = name !== 'check';
    $('view-map').hidden = name !== 'map';
    if (name === 'map') loadMap().catch(() => {});
  }

  // ---------- wire up ----------
  $('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('recBtn').addEventListener('click', toggleRecord);
  $('checkBtn').addEventListener('click', check);
  $('langBtn').addEventListener('click', () => {
    state.lang = state.lang === 'ne' ? 'en' : 'ne';
    localStorageSet('lang', state.lang);
    applyI18n();
  });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
  applyI18n();
})();
