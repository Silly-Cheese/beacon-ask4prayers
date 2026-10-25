# Beacon Scholars

An initiative of **The Prayer Project** at **beacon.ask4prayers.com**.

## Architecture
- Frontend: Static HTML/CSS/JavaScript on **GitHub Pages** (not Firebase Hosting).
- Backend: Firebase project `beacon-ask4prayers` (Authentication, Firestore, Cloud Functions and optional Cloud Storage).
- Deployment: GitHub Pages from `main` / root. Set the custom domain to `beacon.ask4prayers.com`, with DNS CNAME pointing to `silly-cheese.github.io`.

## Program principles
- Student self-applications and student nominations are equally valid official entries.
- Nominations can be named, confidential, or fully anonymous.
- Two qualifying references and verified parent/guardian consent for minors are required **before final recognition**, not before an entry is accepted.
- No monetary award is currently promised.
- Keep sensitive student data out of GitHub and public-facing pages.

## Launch checklist
1. Review program policies, nomination protections, and student safeguarding before opening submissions.
2. Enable Firebase Authentication Email/Password and Anonymous sign-in, configure Firestore and Cloud Functions.
3. Configure Firebase Authentication authorized domains for `beacon.ask4prayers.com` and `silly-cheese.github.io`.
4. Deploy `firestore.rules` and Functions using the Firebase CLI (hosting is intentionally not configured).
5. Configure a CAPTCHA/App Check solution, monitor abuse, and integrate verified email delivery for consent/reference invitations.
6. Set GitHub repository Settings → Pages → Deploy from a branch: `main` / `/(root)`; add custom domain.
7. At the DNS provider: CNAME `beacon` → `silly-cheese.github.io`. Turn on Enforce HTTPS when ready.
8. Confirm the application is safe and tested before enabling public intake.

**Security:** Firebase web configuration is public; **never** put service account keys or email provider secrets in this repository. Firestore rules intentionally deny all direct client access to confidential application collections.
