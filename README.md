# Beacon Scholars

**Beacon Scholars**, an initiative of [The Prayer Project](https://ask4prayers.com/).

- Main website: https://beacon.ask4prayers.com
- Public website hosting: **GitHub Pages** (main branch, root directory)
- Secure backend: Firebase Auth, Firestore, Cloud Functions, optional Firebase Trigger Email extension
- Firebase project: \`beacon-ask4prayers\`
- Look and feel: The Prayer Project's black-and-warm-beige palette

## Current functionality
- Required email/password account registration before student applications.
- Four-step student application with secure autosave to Firestore and resume from dashboard.
- Named, confidential and fully anonymous official nominations. A nomination counts as an official entry. New nominations require a student or guardian email, a U.S. mailing address, or a named or confidential nominator who can deliver the letter. Mailing addresses are visible to administrators in the selection file and can be included in Committee CSV imports. The Committee portal flags older and CSV-imported entries that still need a delivery route.
- Two references, guardian information, individualized invitation links, response forms and controlled administrative verification.
- Nominated student can claim an existing nomination with a verified-email invitation.
- Restricted Selection Committee: candidate file, private reviews, 100-point rubric, founder and committee decisions, recusals, and documented eligibility.
- Scholar Passport: selected Scholar ID, printable official letter and certificate, founder personal note, delivery preference and private achievements.
- Public Scholar ID verification without disclosing non-consenting students' names.
- Optional outbound email via Firebase Trigger Email extension (SMTP configuration required).
- Responsive main-site-matched design and GitHub Actions syntax validation.

## Intake and deployment
An administrator opens or closes applications and nominations together from the Committee page. See [DEPLOYMENT.md](DEPLOYMENT.md) for the PowerShell deploy script and the reviewer workflow. Both entry forms use the same server flag and issue a confirmation with a private entry ID.

The program starts as **honorary recognition only**. Bibles Within Reach comes first; any eventual $500–$10,000-funded awards are speculative and must never be represented as already available or guaranteed. Letters and certificates do not promise funding. Donors do not select recipients.

## Setup and verification
See [IMPLEMENTATION.md](IMPLEMENTATION.md) for data collections, email configuration, custom claims, and committee operations.

## Security notes
Student data is restricted to privileged server-side Cloud Functions. Firestore and Storage rules deny browser direct access to private collections. Functions enforce Firebase Authentication and check the caller’s role where required. Do not commit service-account keys, secret provider credentials, unredacted student applications or API secrets.

The Firebase web configuration is public.
