# Beacon Scholars

**Beacon Scholars**, an initiative of [The Prayer Project](https://ask4prayers.com/).

- Main website: https://beacon.ask4prayers.com
- Public website hosting: **GitHub Pages** (main branch, root directory)
- Secure backend: Firebase Auth, Firestore, Cloud Functions, optional Firebase Trigger Email extension
- Firebase project: \`beacon-ask4prayers\`
- Look and feel: The Prayer Project's black-and-warm-beige palette

## Current functionality
- Required email/password account registration before student applications.
- Seven-section student wizard with secure autosave to Firestore and resume from dashboard.
- Named, confidential and fully anonymous official nominations. A nomination counts as a complete entry; no separate student application required.
- Two references, guardian information, individualized invitation links, response forms and controlled administrative verification.
- Nominated student can claim an existing nomination with a verified-email invitation.
- Restricted Selection Committee: candidate file, private reviews, 100-point rubric, 3–5 reviewers, recusals, documented eligibility and decisions.
- Scholar Passport: selected Scholar ID, printable official letter and certificate, founder personal note, delivery preference and private achievements.
- Public Scholar ID verification without disclosing non-consenting students' names.
- Optional outbound email via Firebase Trigger Email extension (SMTP configuration required).
- Responsive main-site-matched design and GitHub Actions syntax validation.

## Safe operational state
**PUBLIC INTAKE REMAINS CLOSED BY DEFAULT.** The admin must deploy backend changes, configure App Check and authorized accounts, finalize program policies, and validate student/guardian/reference workflows before enabling it. GitHub publication does not open forms by itself.

The program starts as **honorary recognition only**. Bibles Within Reach comes first; any eventual $500–$10,000-funded awards are speculative and must never be represented as already available or guaranteed. Letters and certificates do not promise funding. Donors do not select recipients.

## Setup and verification
See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the latest operational checklist, hosting instructions, emails, custom claim roles, consent safeguards and known readiness limitations.

## Security notes
Student data is restricted to privileged server-side Cloud Functions. Firestore and Storage rules deny browser direct access to private collections. Functions use Firebase App Check and Firebase Authentication where required. Do not commit service-account keys, secret provider credentials, unredacted student applications or API secrets.

The Firebase web config is designed to be public. The reCAPTCHA Enterprise site key is also public, **but must be inserted into \`firebase.js\` after the app is registered**. Never use a secret/reCAPTCHA server key in frontend source.
