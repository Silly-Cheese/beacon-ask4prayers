# Beacon Scholars — Implementation & operational readiness

Repository: \`Silly-Cheese/beacon-ask4prayers\` • GitHub Pages: \`beacon.ask4prayers.com\` • Firebase: \`beacon-ask4prayers\`.

## Current build
- Coordinated **black, ivory and warm-beige** visual system based on The Prayer Project's \`theme.css\`, \`home.css\`, and Beacon recognition pages.
- Student users **must create a Firebase email/password account**; email verification is required for final submission.
- Seven application sections: identity, academic journey, character/service, personal essay, two references, guardian, review.
- Drafts autosave to Firestore through App Check-protected callable functions; protected from all direct client Firestore reads and writes. Resuming a draft requires account sign-in.
- Official nominations: named, confidential or fully anonymous. Nominees **do not** have to reapply. Fully anonymous nominators cannot serve as verified references.
- Private one-time invitations for two character references and guardian consent; recipient responses are recorded and require administrative identity checks before being marked verified.
- Nominated students can claim their existing entry using an email-bound invite token and their own verified Firebase account.
- Review queue, 100-point rubric, conflict recusals, 3–5 committee reviews, administrator eligibility decisions, conditional final decisions and audit logs.
- Selection record, Scholar Passport, print-ready founder-signed-name letter and certificate, optional personalized note, digital/mail preference.
- Future opportunity categories and acknowledgment of **recognition-only** status. Bibles Within Reach precedes any separate Beacon fundraising; possible future awards of $500–$10,000 are purely speculative and must not be marketed as funded.
- Program decisions are independent of donors.

## Deployment, first steps
1. Verify GitHub Pages uses main/root and HTTPS for beacon.ask4prayers.com.
2. Configure Firebase Authentication: Email/Password and Anonymous providers; authorize beacon.ask4prayers.com.
3. Register reCAPTCHA Enterprise **score-based** web key in Firebase App Check. The site key must also be copied to \`firebase.js\` in \`APP_CHECK_SITE_KEY\`. Registering it in the Firebase console *alone* does not automatically place it in this GitHub file. Never place a secret API key/service account into source code.
4. Run \`npm install\` in \`functions\` and deploy using the Firebase CLI from repo root:
   \`firebase deploy --project beacon-ask4prayers --only firestore:rules,storage,functions\`.
   **Do not deploy Firebase Hosting.**
5. Keep \`BEACON_INTAKE_OPEN=false\` in Firebase Functions environment until all minor privacy, consent, mail, abuse and review workflows have been tested.
6. Optionally install Firebase **Trigger Email** extension configured to watch the private \`mail\` collection. Set up SMTP with verified FROM address in the extension. Then set \`BEACON_EMAIL_ENABLED=true\` in Functions environment before deployment to queue invitation and decision messages. Without it, authorized admins generate private URLs for secure manual delivery; do not imply an email was sent.
7. Use Google Cloud Application Default Credentials in a trusted environment and the server-only role script to designate one program administrator and 3–5 independent reviewers. Example in a terminal where ADC has been securely configured:
   \`node grant-role.cjs admin@example.org admin\`
   \`node grant-role.cjs reviewer@example.org reviewer\`
   Do not run the role script from a public website, do not commit credentials. Make sure \`firebase-admin\` is available from the current working directory (run \`npm install\` under the functions folder and run script from there with \`node ../scripts/grant-role.cjs\`).
8. Test with fictional data and Firebase Emulator Suite before processing student information. Sign out/in after custom claims change.

## Essential safeguards and limits
- A complete nomination is a valid *entry*, not a guaranteed final selection.
- Reference/contact data on a nomination may be missing; admin can correct it before issuing invitations.
- Fully anonymous nominators supply no identifying name/email; server-side abuse/security metadata may still exist.
- Verified nominator statements may count as one reference only after a deliberate independent identity check; the other reference must be separate.
- Parents/guardians of minors sign a private form; program administrators verify it. **Typed signatures plus emailed links alone are not universally sufficient for legally mandated verifiable parental consent.** Review the program's legal status and requirements with counsel before processing minors.
- Reviewers cannot access confidential nominators' identities; admins can. Guardian and reference statements never appear on a public site.
- A selected student may print the digital letter/certificate. Printed founder's name is not a cryptographic signature. Mailing requires a separate validated fulfillment process.
- Public recognition is optional; the platform does not publish home addresses or protected reference responses.
- Only authenticated server-side administrators can manage invitations and finalize selections.
- Domain verification, Firebase project configuration, App Check site key, SMTP extension, custom roles and public intake must be finished by the site operator. This repository cannot activate those console settings.
- Intake stays closed by default even when the site is publicly accessible.

## Remaining production acceptance work
- Publish approved privacy, eligibility, record-retention and child protection policies, including an appeals/corrections procedure.
- Operationally verify consent and reference sender identities, student age and GPA eligibility (2.5 or greater per founding program rules).
- Add hardened spam controls beyond per-account rate limits and App Check.
- Configure transactional email, delivery retry and bounced-email reconciliation.
- Conduct a supervised full test across student, anonymous nominator, guardian, references, committee and Scholar acceptance.
- Consider server-rendered PDF issuance with document signature metadata and official mail-fulfillment tracking when ready.

## Collections
- \`drafts\`: private applicant drafts
- \`entries\`: official self/nomination submissions and Scholar records
- \`entries/{id}/references\`: private reference statements
- \`entries/{id}/reviews\`: committee scorecards
- \`entries/{id}/recusals\`: conflict records
- \`invitations\`: one-use hashed private invite tokens
- \`auditLogs\`: restricted action audit trail
- \`submissionQuotas\`, \`selfSubmissionKeys\`: anti-abuse and duplication controls
- \`mail\` (optional): Firebase Trigger Email extension queue, server-writable only

## Operations and fairness
- The program operates in annual cycles, initially 2027.
- Two verified references; guardian approval when under 18; no automatic public exposure.
- 3–5 reviewers independently review; administrators make the documented final decision.
- Future Bibles Within Reach completion and fundraising do not affect today's honorary-only selections.
