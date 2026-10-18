# Fills the official AI Builder Cup template with SafeMigrate content.
import os
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

p = Presentation('template.pptx')
INK = RGBColor(0x14, 0x21, 0x3D)
RED = RGBColor(0xC8, 0x10, 0x2E)
VIDEO = sys.argv[1] if len(sys.argv) > 1 else '(see submission form)'


def body(slide, lines, top=1.4, size=12.5, height=4.0, left=0.35, width=9.3):
    tb = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = tb.text_frame
    tf.word_wrap = True
    for i, line in enumerate(lines):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        bold = line.startswith('**')
        run = para.add_run()
        run.text = line.strip('*')
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = RED if bold else INK
        para.space_after = Pt(4)


def keep_title(slide):
    for sh in slide.shapes:
        if sh.has_text_frame and sh.text_frame.text.strip():
            tf = sh.text_frame
            while len(tf.paragraphs) > 1:
                tf.paragraphs[-1]._p.getparent().remove(tf.paragraphs[-1]._p)
            return


s = p.slides

# 1 Team details
for para in [sh for sh in s[0].shapes if sh.has_text_frame][0].text_frame.paragraphs:
    value = {'Team name': 'Sambhav & Kaustuv', 'Team leader name': 'Sambhav Shahi',
             'Problem Statement': 'Sustainability & Social Impact: SafeMigrate'}
    for key, val in value.items():
        if para.text.startswith(key):
            r = para.add_run()
            r.text = val
            r.font.size = Pt(18)
            r.font.bold = True
            r.font.color.rgb = RED

body(s[2], [
    '**SafeMigrate: check a foreign job offer before you pay.**',
    "A migrant worker forwards the offer exactly as they got it (WhatsApp screenshot, letter photo, voice note or text). A Gemini agent reads it in any of 7 languages, checks every claim against official government records and answers in the worker's language, out loud.",
    'Every claim gets red (checked, failed), amber (cannot be checked online: here is the exact offline step) or green (checked), with the source and date. It never says an offer is "safe".',
    '**Why it matters**',
    '6M+ people leave JAPAC for work each year. Nepal logged 5,632 foreign-employment fraud complaints in FY 2024/25 (Rs 328.7M). The UN estimates 220,000+ people are held in scam compounds in Myanmar and Cambodia, recruited through "customer service" jobs.',
    '**Built by people who lived it**',
    'On 12 Oct 2026 a recruiter offered our team lead a Dubai "customer service" job on a visit visa at an online casino, and asked his religion.',
], size=12)

keep_title(s[3])
body(s[3], [
    '**How it differs from existing tools**',
    'Migrasia PoBot verifies agencies by chat; Singapore ScamShield checks generic scam screenshots; Recruitment Advisor collects reviews. None reads the actual offer and checks each claim against official registries, catches real-agency impersonation, or shares fraud signals across borders.',
    '**How it solves the problem**',
    'Workers receive offers on WhatsApp and Facebook. SafeMigrate meets them there: forward the offer, get a verdict with the exact next step, and a complaint draft for the right regulator (DoFE, BEOE, DMW).',
    '**USP**',
    '1) Claim-by-claim verification with sources. 2) Impersonation check: licensed agency + a number that is not its registered number = warning. 3) Cross-border recruiter network: a number reported in Nepal warns a worker in Pakistan, stored only as an HMAC fingerprint.',
], top=1.2, size=11.5, height=4.3)

body(s[4], [
    '- Input: photo, screenshot, PDF, voice note or pasted text',
    '- Gemini agent with 3 tools: government agency registry, fraud-accused list, cross-border recruiter network',
    '- 7,072 real agency records: Nepal DoFE (1,758, with official phone numbers) and Pakistan BEOE (5,314); Philippines DMW official links',
    '- Deterministic, unit-tested rules: visit-visa trap, fee above legal cap, unlicensed or blocked agency, payment to personal account, scam-compound job pattern, passport demanded early, pressure',
    '- Claim-by-claim red / amber / green with source, check date and offline next step',
    '- 7 languages (Nepali, Urdu right-to-left, Hindi, Bengali, Tagalog, Indonesian, English); verdict translated by Gemini',
    '- Spoken verdict with Gemini text-to-speech',
    "- Complaint draft for the worker's regulator; anonymised risk map",
    '- Telegram bot channel (built), daily AI spending lock, rate limiting, no personal data stored',
], size=12)

body(s[5], [
    '1. Worker chooses country; language follows (Nepal: Nepali, Pakistan: Urdu, Philippines: Tagalog) and forwards the offer.',
    '2. Gemini reads all evidence (multimodal) and calls tools: lookup_agency, check_fraud_list, check_recruiter_contacts.',
    '3. Gemini returns schema-structured facts: visa type, fee, agency, licence number, recruiter contacts, job, key quotes.',
    '4. The server re-runs every check itself, so a skipped tool call can never hide a flag.',
    '5. Rules engine decides the risk; claims engine builds red / amber / green claims with sources.',
    '6. Recruiter contacts are fingerprinted (HMAC) and compared with reports from every country.',
    "7. Verdict is translated (Gemini) and spoken (Gemini TTS) in the worker's language.",
    '8. Worker gets next steps and a complaint draft; an anonymised case is added to the risk map.',
], size=12.5)

body(s[6], ['Live interface: mobile-first, Nepali by default, stamp verdict and claim cards (see the next slides and the live link).'], size=12, height=0.6)

body(s[7], [
    '**Phone browser / Telegram  ->  Firebase Hosting (web app)  ->  Node.js API (container, Cloud Run ready)**',
    '**Gemini:** multimodal reading, function calling (3 tools), structured JSON output, translation, text-to-speech',
    '**Data:** government registries (DoFE, BEOE), fraud list, HMAC recruiter fingerprints, anonymised cases, daily usage counter',
    '**Storage:** Firestore data layer built with security rules that deny all browser access. The free deployment runs the API on a free container host with in-memory storage; Cloud Run and Firestore config is included (Dockerfile, firebase.json, seed script).',
    '**Resilience:** model fallback chain pinned per check, low thinking level (about 9 s per check), per-IP rate limit, daily AI cap.',
], size=12.5)

body(s[8], [
    '- Google Gemini via @google/genai: gemini-3-flash-preview with 3.7 / 3.6 flash fallback, gemini-3.8-flash-tts',
    '- Firebase Hosting, Firestore (data layer and rules), Cloud Run (Dockerfile)',
    '- Node.js 22, Express, multer; vanilla JavaScript front end, Leaflet map',
    '- 27 automated tests (node:test): rules, claims, matching, fingerprints, translation, voice, spending lock',
    '- Real public data: Nepal DoFE recruitment-agency registry, Pakistan BEOE register, Philippines DMW inquiry pages',
    '- ffmpeg voice notes and the Telegram Bot API',
], size=13)

body(s[9], [
    '- Per check: about US$0.002-0.01 including voice (Gemini Flash).',
    '- Hosting: Firebase Hosting free tier; container free tier; Cloud Run and Firestore free tiers cover pilot traffic.',
    '- 10,000 checks a month: about US$20-100.',
    '- Workers use it free. Migrant NGOs, help desks and regulators are the first partners; donors already fund tools like this (ILO FAIR, Zoom Cares for PoBot).',
    '- Guardrails: daily AI cap, rate limiting, maximum instances.',
], size=13)

body(s[11], [
    '- End-to-end check (screenshot or text to verdict): about 9 s with low thinking level (first version: 91 s).',
    '- Registry coverage: 1,758 Nepal agencies (1,116 active, 583 blocked); 5,314 Pakistan agencies (2,883 valid, 2,431 cancelled, expired or surrendered).',
    '- Live test with a real Dubai visit-visa iGaming offer: HIGH RISK; visa, permit and job red; agency, fee and recruiter amber.',
    '- Cross-border test: a number reported from Nepal was flagged for a worker in Pakistan checking a different message.',
    '- 27 automated tests pass; fixed false positive: a placeholder "unknown" is never treated as an agency name.',
], size=12.5)

body(s[12], [
    '- Move the API to Cloud Run with Firestore and Vertex AI (configuration ready).',
    "- Digitise DoFE's scanned fraud-case PDFs with Gemini (importer built).",
    '- New country packs: Bangladesh (BMET), Sri Lanka (SLBFE), India (eMigrate); Philippines registry data.',
    '- WhatsApp channel; native-speaker review of all 7 languages.',
    '- Accuracy study on 100+ real offers with migrant NGOs; pilots with migrant resource centres.',
], size=13)

for sh in s[13].shapes:
    if sh.has_text_frame and 'GitHub' in sh.text_frame.text:
        links = {'GitHub Public Repository': 'https://github.com/sasam17/safemigrate',
                 'Demo Video Link (3 Minutes)': VIDEO,
                 'Final Product Link': 'https://safemigrate-cup-2026.web.app'}
        for para in sh.text_frame.paragraphs:
            if para.text.strip() in links:
                r = para.add_run()
                r.text = ': ' + links[para.text.strip()]
                r.font.color.rgb = RED
                r.font.size = Pt(14)

for idx, img, top in [(10, 'shot-verdict.png', 1.35), (6, 'shot-home.png', 1.95)]:
    if os.path.exists(img):
        s[idx].shapes.add_picture(img, Inches(0.4), Inches(top), width=Inches(9.2))

ids = p.slides._sldIdLst
ids.remove(list(ids)[1])  # the template's "how to use" instruction slide
p.save('SafeMigrate-deck.pptx')
print('saved')
