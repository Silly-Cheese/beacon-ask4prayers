# Launch Beacon Scholars intake

GitHub Pages serves [Beacon Scholars](https://beacon.ask4prayers.com/) from the repository’s `main` branch and root folder. Firebase project `beacon-ask4prayers` supplies Authentication, Cloud Functions and Firestore. The same server flag opens both applications and nominations for the Class of 2027. Set it back to `false` and redeploy Functions to pause both paths.

## Firebase setup

- In [Firebase Authentication](https://console.firebase.google.com/project/beacon-ask4prayers/authentication/providers), enable Email/Password for applicants and named or confidential nominators, and Anonymous for anonymous nominations. Authorize `beacon.ask4prayers.com` for Auth.
- In [Firebase App Check](https://console.firebase.google.com/project/beacon-ask4prayers/appcheck), verify that the web app is registered with the reCAPTCHA Enterprise site key used in `firebase.js` and that the live domain is allowed by that key. Submissions and draft operations require App Check.
- Ensure the Firestore database exists. Use the existing Firebase custom claims to assign a program administrator and the selection committee. The administrator can issue private guardian and reference links for manual delivery or queue them through the configured Trigger Email extension.

## Deploy and open

From the repository root in PowerShell:

```powershell
npx.cmd --yes firebase-tools@latest login
npm.cmd --prefix functions install
```

Set `BEACON_INTAKE_OPEN=true` in `functions/.env.beacon-ask4prayers` (or in your existing `functions/.env` if that is where you manage production settings). Keep any existing mail setting and other Firebase configuration in the same file. To pause intake while validating production, deploy first with the value `false` and repeat with `true` when ready.

```powershell
npx.cmd --yes firebase-tools@latest deploy --project beacon-ask4prayers --only "functions,firestore:rules"
```

Storage is unused by intake. GitHub Pages publishes the frontend.

## Verify production

Call the public status endpoint from PowerShell:

```powershell
Invoke-RestMethod -Method Post `
  -Uri 'https://us-central1-beacon-ask4prayers.cloudfunctions.net/getProgramSettings' `
  -ContentType 'application/json' -Body '{"data":{}}' |
  Select-Object -ExpandProperty result
```

Expect `cycle: 2027`, `intakeOpen: True`, and `honoraryOnly: True` after launch. On the live site, verify that both entry pages show as open. Use fictional data to test a verified student saving and submitting, an anonymous nomination, and a named nomination after sign-in. Confirm each receipt appears in the committee queue, then verify a private guardian and reference invitation through completion. Reviewers should see reference responses without names, signatures, email addresses or confidential nominator records.

If the status endpoint returns 404, check that `getProgramSettings` appears under Functions in the correct project and region. If the status is open but submissions fail, check App Check metrics and the relevant Auth provider before changing the launch flag.
