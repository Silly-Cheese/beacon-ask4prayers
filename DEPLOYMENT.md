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

The queue shows stage counts for loaded entries. Search by student, school, or entry ID, or use the **Review and follow-up** filter to find entries waiting for your evaluation or missing program requirements. Select **Load more entries** to include older submissions. A recorded recusal removes the file from that reviewer’s queue.

Inside a selection file, **Overview** shows the current stage and readiness checklist. Keep the student’s statement, reference responses, and your evaluation open in their own sections. The evaluation form calculates the score out of 100. **Eligibility & decision** lists the outstanding requirements for each outcome.

New entries begin in **Processing**. Committee members confirm the account attached to a direct application or link a nomination to a student account after independently verifying identity. Once any nomination follow-up is complete, Processing moves to **Eligibility screening**. Administrators then verify eligibility to advance to **Committee review**, then to **Finalist** once required forms are verified. The **Final decision** section applies the existing review requirements when naming a Scholar. Class of 2027 is capped at two Scholars.

The **Selection stages** section lets administrators move an entry back one stage or reopen a decision with a reason. Reopening a Scholar decision returns the entry to Finalist and suspends verification and Passport access until the decision is recorded again. Reviewers can see the stages and record their evaluations. Students see the status of their own linked entries in My Dashboard.

After opening entries, submit a fictional application and nomination and confirm each receipt appears in the Committee queue. Administrators can issue guardian and reference invitations there. Links can be delivered manually or queued by a configured Firebase Trigger Email extension.


## Import emailed nominations from CSV

An administrator can open [Committee](https://beacon.ask4prayers.com/#committee), expand **Bulk import · emailed nominations (CSV)**, and upload a CSV file. Use **Download CSV template** for a clean set of headers, or upload an existing spreadsheet exported as UTF-8 CSV. Match any unfamiliar headers with **Adjust column mapping**, review the preview, then select **Import nominations**. Each valid CSV row creates a separate nomination record with its own entry ID.

Only **Student Name** (or first and last name columns) and **Nomination Statement** are required for the import; a meaningful statement must contain at least 15 characters. School, grade, graduation year, GPA, guardian information and references can be missing from emailed nominations. The imported entries enter **Processing** and remain unverified until the committee obtains and checks the missing information. The CSV import does **not** verify the sender, assert a signed nomination declaration, verify eligibility, send emails, or automatically create guardian/reference consent responses.

Importer protection: administrators must have the Firebase admin custom claim and a verified account email. CSVs are limited to **300 records and 2 MB**; each server request processes at most **20 nominations**. The preview flags invalid rows, and imports proceed in batches with per-row results. An identical nomination already imported is skipped automatically, including if the file is uploaded again. Similar names are **not** silently merged; check duplicate warnings in each selection file before merging supporting nominations. If an import fails midway, correcting the error and retrying does not re-create already imported records.

Any nominator information from a CSV remains **confidential**, visible only to Beacon administrators. If no nominator identity is supplied, the entry is treated as anonymous. Students cannot see the importing administrator's identity or automatically see sender information. Protect any exported email or CSV file after importing because it may contain student or nominator contact information.

Deploy the latest **Firebase Functions** (not just GitHub Pages) before using this tool. The new callable function is importNominations.


## Nomination lookup and account processing

The public homepage features a prominent **Check for my nomination** action, and the main navigation includes **Check nomination**. Students can visit [Check for a nomination](https://beacon.ask4prayers.com/#find-nomination), enter their full name, and receive a simple nomination-existence result. No student essay, status, addresses, or confidential nominator details are returned by the name lookup. The lookup has per-account and IP-based hourly rate limits.

Students who find a nomination create an account with **their own email and password**, verify the email, and request to connect their record by providing their school and grade. **Name, self-reported school, and self-reported grade are not proof of identity.** A committee member must independently verify the request before linking it; the selection file requires a verification method and documented notes. Once linked, the student opens My Dashboard to complete their nomination follow-up, references, and guardian consent where required.

Committee **Selection queue → Needs account processing (new and older)** shows all records without a confirmed student account, regardless of whether the selection record is in Processing, screening, review, finalist, or an earlier final decision. The **Student account** panel in the selection file shows outstanding name-lookup requests and existing Beacon accounts from previous student applications with matching names. Authorized committee members can link an existing account or confirm the account already attached to an older application. Check independent evidence before choosing a match, particularly for students with the same name.

For older records, account connection is **independent of the selection stage**. Linking or confirming an account does not change an old decision, erase evaluations, change eligibility, or reset finalist recognition. Records already marked **Not selected** can be connected so the rightful student can view the decision; previously selected Scholars remain selected. New nominations and direct applications still start in Processing, and the committee advances them only after account confirmation and required follow-up. Legacy records already at later stages remain at those stages.

No new Entry Keys are issued. Previously printed Entry Keys are still accepted through the legacy claim page so letters already delivered continue to work. New nomination letters point students to the name lookup and account-connection procedure.

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
