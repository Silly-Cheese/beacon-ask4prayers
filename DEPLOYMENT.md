# Deploy Beacon Scholars

The public website is hosted on GitHub Pages from `main`. The PowerShell script below deploys the Firebase backend to `beacon-ask4prayers` and prints the live intake status.

## Deploy from PowerShell

Open the `beacon-ask4prayers` repository folder. Sign in to the Firebase CLI once with the Google account that manages the project. Cloud Functions deploy with the Node.js 22 runtime declared in the repo. On a computer running Node.js 24, npm may print an engine warning during installation.

```powershell
npx.cmd --yes --package=firebase-tools@latest -- firebase.cmd login
```

For the first deployment and future backend updates, run these two lines from the repo root. The process-scoped execution policy applies only to the PowerShell process that runs this script.

```powershell
git pull --ff-only origin main
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-beacon.ps1
```

If deployment fails, follow the Firebase CLI message. The project needs a Firestore database and the Blaze plan to deploy Cloud Functions. Under [Authentication](https://console.firebase.google.com/project/beacon-ask4prayers/authentication/providers), enable Email/Password for Beacon accounts and Anonymous for anonymous nominations. Add `beacon.ask4prayers.com` to [Authorized domains](https://console.firebase.google.com/project/beacon-ask4prayers/authentication/settings).

## Set an intake deadline or close entries

Sign in as a Beacon administrator and open the [Committee page](https://beacon.ask4prayers.com/#committee). At the top, use **Intake deadline** to save the last day for new applications and nominations. The deadline ends at 11:59 p.m. Central Time. It appears on the public pages automatically. Use **Open intake manually** or **Close intake manually** to control intake before that deadline. Extend or remove a passed deadline to reopen intake, with the manual switch set to open. Entries already received remain in the review queue, and follow-up can continue on open entries.

Intake starts closed on a fresh deployment. If a prior deployment set `BEACON_INTAKE_OPEN`, that value carries forward until an administrator uses the Committee control. After the first change in the Committee page, the saved website setting takes precedence.

## Review entries

Reviewers create a Beacon account using the email address that the administrator will authorize. Use the Firebase Admin SDK credentials and role commands described in [IMPLEMENTATION.md](IMPLEMENTATION.md). After the role is granted, the reviewer signs out and back in, then goes to [Committee](https://beacon.ask4prayers.com/#committee) and selects **Open Selection File**.

Administrators can advance an entry from **Submitted** to **Eligibility screening**, verify eligibility to move into **Committee review**, then advance to **Finalist** once the required forms are verified. The **Final decision** section applies the existing review requirements when naming a Scholar. Class of 2027 is capped at two Scholars.

The **Selection stages** section lets administrators move an entry back one stage or reopen a decision with a reason. Reopening a Scholar decision returns the entry to Finalist and suspends verification and Passport access until the decision is recorded again. Reviewers can see the stages and record their evaluations. Students see the status of their own linked entries in My Dashboard.

After opening entries, submit a fictional application and nomination and confirm each receipt appears in the Committee queue. Administrators can issue guardian and reference invitations there. Links can be delivered manually or queued by a configured Firebase Trigger Email extension.

## Nomination letters and student follow-up

Open a nomination in Committee and click **Print nomination letter**. An unlinked, active nomination gets a private, 30-day Entry Key. If the letter is reissued from a newly opened selection file, the previous key is replaced after confirmation. Give the letter privately to the student.

The student signs in with a verified account, enters the key at [Continue your nomination](https://beacon.ask4prayers.com/#claim), and submits the follow-up from **My dashboard**. They supply outstanding academic and character references and request guardian consent if they are under 18. The submitted request appears in the Committee selection file. With Apps Script configured, outstanding forms are emailed automatically. Admins can also issue or replace private forms from **References and consent**.

## Branded email and automatic form requests

Beacon uses Firebase to generate verification links and Google Apps Script to send the branded emails. Once configured, Beacon also emails private forms to outstanding references and to the parent or guardian when the student is under 18. This happens when a student submits a new application or submits follow-up after claiming a nomination. Nominator submissions alone do not send emails.

### Set up the sender once

1. Sign into the Google account that should send Beacon email. Create a project at [Google Apps Script](https://script.google.com/home) and paste the contents of [apps-script/Code.gs](apps-script/Code.gs) into its `Code.gs` editor.
2. Generate a private secret from the Beacon repo in PowerShell:

   ```powershell
   node.exe -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   In Apps Script, open **Project Settings → Script properties** and add `BEACON_MAIL_SECRET` with that value. Save the identical value to Firebase Secret Manager using the command below. Enter it when the CLI prompts. Keep it out of Git and the browser code.

   ```powershell
   npx.cmd --yes --package=firebase-tools@latest -- firebase.cmd functions:secrets:set BEACON_MAIL_SECRET --project beacon-ask4prayers
   ```

3. In Apps Script choose **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone**. Authorize Google’s mail permission when prompted. Firebase signs each request with your secret. The web app accepts only signed, recent requests. Copy the deployment URL ending in `/exec`. If you update the script later, edit the existing deployment and select **New version** to keep its URL.
4. Set `BEACON_APPS_SCRIPT_URL` in `functions/.env.beacon-ask4prayers` to that URL. Use **Authentication → Settings → Authorized domains** to confirm that `beacon.ask4prayers.com` is listed for the verification return link. Then run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy-beacon.ps1
   ```

### Test delivery

Create a test account with an inbox you control, verify the email, then submit fictional follow-up or a test application using separate inboxes you control. Check that each reference receives their own form and that the guardian receives a consent email only when required. In Firestore, the private `beaconMailJobs` collection shows `pending`, `sending`, `sent`, `cancelled`, or `failed`. A `sent` job means Apps Script accepted the send. Inbox delivery can still be affected by spam filtering and provider policies.

If a form email fails, open the entry in Committee and issue a replacement from **References and consent**. The replacement is queued through Apps Script and can also be copied for private delivery. Existing applications and submitted nomination follow-ups are not emailed retroactively. The Apps Script sender’s daily mail quota applies.

If the Apps Script URL is blank, Beacon uses Firebase’s verification email and retains the manual form workflow. The deployed email worker still requires `BEACON_MAIL_SECRET` in Secret Manager. A configured Firebase Trigger Email extension can still handle decisions and Scholar account-claim invitations under the existing `BEACON_EMAIL_ENABLED` setting.
