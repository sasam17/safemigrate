# SafeMigrate pitch deck content (paste into the official AI Builder Cup template, export PDF under 5 MB)

Category: Sustainability & Social Impact. Language: English.

1. Title
   SafeMigrate: check a foreign job offer before you pay.
   Team Sambhav & Kaustuv · Kathmandu, Nepal · Google Cloud AI Builder Cup 2026

2. The problem
   - 6M+ people leave JAPAC for work every year (Philippines 2.6M in 9 months of 2024, Bangladesh 1.0M, Nepal 839k, Pakistan 727k).
   - Nepal: 5,632 foreign-employment fraud complaints in FY 2024/25, Rs 328.7M lost.
   - UN: 220,000+ people held in scam compounds in Myanmar and Cambodia, recruited from 80+ countries with "customer service" jobs.
   - Recruitment happens on WhatsApp and Facebook. Government registries exist, but workers can't read or search them.

3. Why us
   - On 12 Oct 2026 a recruiter offered Sambhav a Dubai "customer service" job: visit visa, online casino, "what is your religion?". The demo uses that real chat.

4. The solution (one picture: phone screenshot → verdict card)
   - Forward the offer as photo, screenshot, voice note or text, on the web or Telegram.
   - Every claim checked: agency licence, visa type, government approval, fee, job, recruiter number, payment.
   - Red / amber / green with source and date. Amber always tells the worker the exact offline step. It never says "safe".
   - Verdict read aloud in Nepali.

5. How Gemini does it (the 40% slide)
   - Multimodal: reads screenshots, letters, PDFs and voice notes in Nepali, Urdu, Tagalog, Hindi, English, Arabic.
   - Function calling: 3 tools (lookup_agency, check_fraud_list, check_recruiter_contacts).
   - Structured output with a response schema → a deterministic, unit-tested rules engine decides the verdict.
   - Gemini TTS speaks the verdict in Nepali.
   - Gemini digitised DoFE's scanned fraud-case PDFs into a searchable list.
   - Resilience: model fallback chain, pinned per check.

6. Architecture
   phone / Telegram → Firebase Hosting → Cloud Run (Node) → Gemini → Firestore (registries, fraud list, fingerprints, anonymised cases). Firestore rules deny all browser access.

7. What only SafeMigrate does (comparison table)
   | | SafeMigrate | Migrasia PoBot | ScamShield (SG) | Recruitment Advisor |
   | Reads the actual offer (image/voice) | ✅ | ❌ | screenshots, general scams | ❌ |
   | Checks claims against official registries | ✅ | agency only | ❌ | reviews |
   | Detects real-agency impersonation (official numbers) | ✅ | ❌ | ❌ | ❌ |
   | Cross-border recruiter network | ✅ | ❌ | ❌ | ❌ |
   | South Asia, Nepali voice | ✅ | ❌ | ❌ | partial |

8. The cross-border network (the "wow")
   A recruiter's number is stored only as an HMAC fingerprint. Reported in Nepal → flagged for a worker in Pakistan. One report protects workers in every country.

9. Real data, real results
   - 1,758 DoFE agencies (1,116 active, 583 blocked) with official numbers.
   - 5,314 BEOE agencies (2,883 valid, 2,431 cancelled/expired/surrendered).
   - [Fraud cases digitised: N] · [Accuracy on 30 real offers: X caught / Y missed] ← fill after testing
   - ~9 s per check.

10. Scale: country packs
    Nepal (full) · Pakistan (registry) · Philippines (official links) · next: Bangladesh, Sri Lanka, India.
    A country is one registry snapshot + one rules entry.

11. Impact and who it's for
    Workers use it free. NGOs, migrant resource centres and help desks put it in workers' hands; regulators get anonymised risk data.
    [Partner quote, if one replies]

12. Close
    "Check before you go." · live URL · GitHub · Telegram bot
