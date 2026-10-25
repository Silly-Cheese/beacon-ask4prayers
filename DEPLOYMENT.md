# GitHub Pages + Firebase Deployment

This repository intentionally DOES NOT include Firebase Hosting. The public website runs on GitHub Pages; backend Cloud Functions run in Firebase.

## GitHub Pages
1. Go to repository **Settings → Pages**.
2. Select **Deploy from a branch**, **main**, **/(root)**, Save.
3. Set **Custom domain** to **beacon.ask4prayers.com**.
4. DNS: add \`CNAME\` record **beacon** → **silly-cheese.github.io** (not a repo path).
5. Enable **Enforce HTTPS** after domain verification and certificate issuance.
6. Verify \`https://beacon.ask4prayers.com\` resolves to this site. DNS changes are not performed by this repository.

## Firebase project
Install Firebase CLI; run from repository root:
\`\`\`powershell
npm install -g firebase-tools
firebase login
firebase use --add
# Choose beacon-ask4prayers and use alias default
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,storage,functions
\`\`\`
If \`firebase use --add\` is inconvenient use \`firebase deploy --project beacon-ask4prayers --only firestore:rules,storage,functions\`.

## Console configuration
- Authentication → Sign-in method: enable **Email/Password** and **Anonymous**.
- Authentication → Settings → Authorized domains: add \`beacon.ask4prayers.com\` and \`silly-cheese.github.io\` as appropriate.
- Firestore: provision the database.
- App Check: register the web app with **reCAPTCHA Enterprise**, then put the public site key into \`firebase.js\` (\`APP_CHECK_SITE_KEY\`). Enable enforcement only after testing, and enforce for Cloud Functions before public intake.
- For administrator/reviewer access, assign Firebase Authentication **custom claims** using an authorized server or administrative process. Never assign these claims through browser JavaScript.

## IMPORTANT: submissions are disabled by default
The Cloud Function \`submitEntry\` checks \`BEACON_INTAKE_OPEN\` and requires a valid App Check token, even when callable function App Check is not globally enforced. With the provided \`functions/.env.example\` as a guide, create \`functions/.env\` locally (ignored by Git) and keep \`BEACON_INTAKE_OPEN=false\` until ALL required verification and safeguarding processes are implemented and approved.

The first-stage intake stores a submitted entry securely but **does not send reference requests, obtain guardian consent, issue letters, or finalize selections**. Build and test these workflows before accepting real minors' personal data. Do not tell applicants these steps have occurred when they have not.

## Data security
\`firestore.rules\` and \`storage.rules\` deny all browser reads/writes by default. All confidential operations must be validated in Cloud Functions using Admin SDK. Public source files must never contain private student data, service-account keys, or email API tokens.

## Testing
- Sign up, email verification, sign in/out, reset password.
- Confirm submission blocked when intake is off.
- Register App Check and confirm invalid/no app token rejected.
- Test valid application and nomination in emulator with fixtures.
- Verify a regular user cannot query \`entries\`, consent, or references directly.
- Verify only custom-claim reviewers can read committee queue.
- Test mobile layouts and keyboard access.

## Future development (not yet delivered)
- Guardian invitation & verifiable consent; student participation and separate publicity consent.
- Two reference invitation forms and identity/email verification.
- Student invitation acceptance for nominations; anonymous nomination moderation.
- Committee decision rubric, conflict recusals, and audit logs.
- Scholar credential, PDF letter/certificate generation, mailing address and secure verification.
- Email service integration; records retention and verified deletion workflows.
