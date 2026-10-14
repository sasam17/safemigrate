// Telegram bot: workers forward the offer (photo, screenshot, PDF, voice note
// or text) in the app they already use, and get the claim-by-claim verdict
// back as text plus a Nepali voice note. Webhook on Cloud Run, polling locally.
import { spawn } from 'node:child_process';
import { analyzeOffer } from './agent.js';
import { saveCase } from './store.js';
import { speak, verdictScript, localText, RISK_LABEL } from './voice.js';
import { translateReport } from './translate.js';

const ORIGIN_LANG = { NP: 'ne', PK: 'ur', PH: 'tl' };

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${TOKEN}`;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const origins = new Map(); // chatId -> 'NP' | 'PK' | 'PH'
const busy = new Set();

export const telegramEnabled = () => Boolean(TOKEN);

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`);
  return json.result;
}

async function upload(method, chatId, field, buffer, filename) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append(field, new Blob([buffer]), filename);
  const res = await fetch(`${API}/${method}`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`);
}

async function download(fileId) {
  const file = await call('getFile', { file_id: fileId });
  if (file.file_size > MAX_FILE_BYTES) throw new Error('file too large');
  const res = await fetch(`${FILE_API}/${file.file_path}`);
  return Buffer.from(await res.arrayBuffer());
}

/** WAV -> OGG/Opus so Telegram shows a playable voice note. */
function toOgg(wav) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
    const chunks = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exit ${code}`))));
    ff.stdin.end(wav);
  });
}

const ICON = { red: '🔴', amber: '🟠', green: '🟢' };
const LABEL = {
  agency: ['म्यानपावर इजाजत', 'Agency licence'], visa: ['भिसा', 'Visa'], permit: ['सरकारी स्वीकृति', 'Government approval'],
  fee: ['शुल्क', 'Fee'], job: ['काम', 'Job'], recruiter: ['एजेन्टको नम्बर', 'Recruiter contact'], payment: ['भुक्तानी', 'Payment'],
};
const STAMP_ICON = { high: '🚨', medium: '⚠️', low: '✅' };

/** Plain-text report (no Markdown, so model text can never break formatting). */
export function formatReport(r, lang = 'ne') {
  const np = lang === 'ne';
  const i = np ? 0 : 1;
  const text = localText(r, lang);
  const t = r.i18n?.lang === lang ? r.i18n : null;
  const next = (c, k) => t?.claims?.[k]?.next ?? (np ? c.next_np : c.next_en);
  const label = (RISK_LABEL[lang] ?? RISK_LABEL.en)[r.risk];
  const lines = [`${STAMP_ICON[r.risk]} ${label.toUpperCase()}`, '', text.summary, ''];
  const crossIdx = r.flags.findIndex((f) => f.id === 'recruiter_reported');
  if (crossIdx >= 0) {
    const f = r.flags[crossIdx];
    lines.push(`🌏 ${t?.flags?.[crossIdx] ?? (np ? f.title_np : f.title_en)}`, '');
  }
  r.claims.forEach((c, k) => {
    lines.push(`${ICON[c.status]} ${(LABEL[c.id] ?? [c.id, c.id])[i]}: ${text.claim(c, k)}`);
    if (c.status !== 'green' && next(c, k)) lines.push(`   → ${next(c, k)}`);
  });
  lines.push('', np ? 'यो खतराको संकेत हो, कानुनी निर्णय होइन।' : 'Risk signals, not a legal ruling.');
  if (r.origin?.complaint_url) lines.push(`${np ? 'उजुरी' : 'Report'}: ${r.origin.complaint_url}`);
  return lines.join('\n');
}

const WELCOME = 'नमस्ते! विदेशको जागिरको अफर लेटर, WhatsApp स्क्रिनसट, भ्वाइस म्यासेज वा म्यासेज यहाँ पठाउनुहोस्। हामी सरकारी रेकर्डसँग जाँच गरेर बताउँछौं।\n\nHello! Forward a foreign job offer (photo, screenshot, voice note or text) and we check every claim against government records.\n\nतपाईं कुन देशबाट? / Where are you leaving from?';

async function askOrigin(chatId) {
  await call('sendMessage', {
    chat_id: chatId, text: WELCOME,
    reply_markup: { inline_keyboard: [[
      { text: '🇳🇵 Nepal', callback_data: 'origin:NP' },
      { text: '🇵🇰 Pakistan', callback_data: 'origin:PK' },
      { text: '🇵🇭 Philippines', callback_data: 'origin:PH' },
    ]] },
  });
}

async function evidenceFrom(msg) {
  const files = [];
  if (msg.photo?.length) files.push({ mimeType: 'image/jpeg', data: (await download(msg.photo.at(-1).file_id)).toString('base64') });
  if (msg.voice) files.push({ mimeType: msg.voice.mime_type || 'audio/ogg', data: (await download(msg.voice.file_id)).toString('base64') });
  if (msg.audio) files.push({ mimeType: msg.audio.mime_type || 'audio/mpeg', data: (await download(msg.audio.file_id)).toString('base64') });
  if (msg.document && /^(image\/|application\/pdf)/.test(msg.document.mime_type ?? '')) {
    files.push({ mimeType: msg.document.mime_type, data: (await download(msg.document.file_id)).toString('base64') });
  }
  return { text: msg.text || msg.caption || '', files };
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  if (msg.text === '/start' || msg.text === '/country') return askOrigin(chatId);
  if (busy.has(chatId)) {
    await call('sendMessage', { chat_id: chatId, text: '⏳ पहिलेको जाँच हुँदैछ… / Still checking the last one…' });
    return;
  }
  const origin = origins.get(chatId) ?? 'NP';
  const lang = ORIGIN_LANG[origin] ?? 'en';
  const np = lang === 'ne';
  busy.add(chatId);
  try {
    const input = await evidenceFrom(msg);
    if (!input.text.trim() && input.files.length === 0) {
      await call('sendMessage', { chat_id: chatId, text: np ? 'फोटो, भ्वाइस वा म्यासेज पठाउनुहोस्।' : 'Send a photo, voice note or message.' });
      return;
    }
    await call('sendChatAction', { chat_id: chatId, action: 'typing' });
    await call('sendMessage', { chat_id: chatId, text: np ? '🔎 सरकारी रेकर्डसँग जाँच गर्दैछौं…' : '🔎 Checking against government records…' });
    const report = await translateReport(await analyzeOffer({ ...input, origin }), lang);
    await saveCase({ origin, country: report.country, risk: report.risk, flagIds: report.flags.map((f) => f.id), agencyStatus: report.agency?.status });
    await call('sendMessage', { chat_id: chatId, text: formatReport(report, lang), disable_web_page_preview: true });
    try {
      const ogg = await toOgg(await speak(verdictScript(report, lang), lang));
      await upload('sendVoice', chatId, 'voice', ogg, 'verdict.ogg');
    } catch (err) {
      console.error('[telegram] voice failed:', err.message);
    }
  } catch (err) {
    console.error('[telegram] check failed:', err.message);
    await call('sendMessage', { chat_id: chatId, text: np ? 'माफ गर्नुहोस्, जाँच पूरा भएन। फेरि प्रयास गर्नुहोस्।' : 'Sorry, the check could not finish. Please try again.' }).catch(() => {});
  } finally {
    busy.delete(chatId);
  }
}

export async function handleUpdate(update) {
  if (update.callback_query) {
    const q = update.callback_query;
    const code = String(q.data ?? '').replace('origin:', '');
    if (['NP', 'PK', 'PH'].includes(code)) origins.set(q.message.chat.id, code);
    await call('answerCallbackQuery', { callback_query_id: q.id, text: code });
    await call('sendMessage', {
      chat_id: q.message.chat.id,
      text: code === 'NP' ? 'ठिक छ। अब अफर पठाउनुहोस्।' : 'OK. Now forward the offer.',
    });
    return;
  }
  if (update.message) await handleMessage(update.message);
}

/** Local development: long polling instead of a webhook. */
export async function startPolling() {
  await call('deleteWebhook', {});
  let offset = 0;
  console.log('[telegram] polling for messages');
  for (;;) {
    try {
      const updates = await call('getUpdates', { offset, timeout: 30 });
      for (const u of updates) {
        offset = u.update_id + 1;
        handleUpdate(u).catch((err) => console.error('[telegram]', err.message));
      }
    } catch (err) {
      console.error('[telegram] poll error:', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
