# Deploy Beacon Scholars

The public website is hosted on GitHub Pages from `main`. The PowerShell script below deploys the Firebase backend to `beacon-ask4prayers` and prints the live intake status.

## Deploy from PowerShell

Open the `beacon-ask4prayers` repository folder. Use Node.js 22 and sign in to the Firebase CLI once with the Google account that manages the project.

```powershell
npx.cmd --yes firebase-tools@latest login
```

For the first deployment and future backend updates, run these two lines from the repo root. The process-scoped execution policy applies only to the PowerShell process that runs this script.

```powershell
git pull --ff-only origin main
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-beacon.ps1
```

If deployment fails, follow the Firebase CLI message. The project needs a Firestore database and the Blaze plan to deploy Cloud Functions. Under [Authentication](https://console.firebase.google.com/project/beacon-ask4prayers/authentication/providers), enable Email/Password for Beacon accounts and Anonymous for anonymous nominations. Add `beacon.ask4prayers.com` to [Authorized domains](https://console.firebase.google.com/project/beacon-ask4prayers/authentication/settings).

## Open or close entries

Sign in as a Beacon administrator and open the [Committee page](https://beacon.ask4prayers.com/#committee). At the top, select **Open applications and nominations** or **Close applications and nominations**. Changes take effect without a deployment. Both forms share this setting. Existing entries stay in the review queue.

Intake starts closed on a fresh deployment. If a prior deployment set `BEACON_INTAKE_OPEN`, that value carries forward until an administrator uses the Committee control. After the first change in the Committee page, the saved website setting takes precedence.

## Review entries

Reviewers create a Beacon account using the email address that the administrator will authorize. Use the Firebase Admin SDK credentials and role commands described in [IMPLEMENTATION.md](IMPLEMENTATION.md). After the role is granted, the reviewer signs out and back in, then goes to [Committee](https://beacon.ask4prayers.com/#committee) and selects **Open Selection File**.

After opening entries, submit a fictional application and nomination and confirm each receipt appears in the Committee queue. Administrators can issue guardian and reference invitations there. Links can be delivered manually or queued by a configured Firebase Trigger Email extension.
