# Fleet Maintenance Log

Track repairs, service and cost on the equipment fleet. Records save to a Google Sheet, so everyone with the link and the shop code sees the same data.

Files:
- `index.html` — the app (hosted on GitHub Pages)
- `Code.gs` — the Google Sheets backend (runs in Google Apps Script)

Setup takes about 15 minutes. A computer is easier than a phone for steps 1 and 2.

## 1. Make the Google Sheet backend

1. Go to sheets.google.com and create a blank sheet. Name it **Fleet Maintenance Log**.
2. Click **Extensions → Apps Script**.
3. Delete what's in the editor and paste in everything from `Code.gs`.
4. On the line `const ACCESS_CODE = 'CHANGE-ME';`, replace `CHANGE-ME` with your own shop code (for example `rockingham-shop-42`). Your team types this once on their phone.
5. Click **Save**.
6. In the function dropdown at the top, choose **setup** and click **Run**. Google asks you to authorize it: choose your account → **Advanced** → **Go to (project name)** → **Allow**. The script creates the tabs it needs (`units`, `records`, `employees`, `checks`, `levels`, `pmTasks`, `checklists`, `settings`) and a Google Drive folder named **Fleet Maintenance Photos**.

## 2. Publish it as a web app

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**.
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" lets the page reach the script. The shop code is what keeps strangers from reading or changing your records.

## 3. Put the app on GitHub

1. Sign in to github.com as **chbtools** and click **New repository**. Name it `fleet-maintenance-` (the trailing hyphen is part of the name), set it to **Public**, and click **Create repository**.
2. Click **uploading an existing file** and upload `index.html`, `Code.gs` and `README.md`. Click **Commit changes**.
3. Open `index.html` in the repo and click the pencil (Edit). Find this line near the top:

   ```
   window.FLEET_SCRIPT_URL = "PASTE_YOUR_WEB_APP_URL_HERE";
   ```

   Replace `PASTE_YOUR_WEB_APP_URL_HERE` with the web app URL from step 2. Keep the quotes. Commit.
4. Go to **Settings → Pages**. Under "Branch," choose **main** and **/ (root)**, then **Save**.
5. After a minute or two the app is live at:

   **https://chbtools.github.io/fleet-maintenance-/**

## 4. Give it to your team

Send them the link and the shop code. On a phone they can use **Add to Home Screen** so it opens like an app.

## Excel workbook

Tap **Excel** on the Fleet tab, or **Excel (all data)** on the Reports tab, to download every unit and job as an Excel file. It has three tabs:

- **Dashboard** — units, units down, open jobs, spend this month, year to date and all time; cost by unit; and cost by month for the last 12 months.
- **Work Log** — every job, with filter arrows on each column, including hours the unit was down.
- **Units** — the fleet list with status, PM status, warranty, certification, registration, and the PM schedule.

The Dashboard totals are formulas, so they update if you add or fix rows in the Work Log tab.

## Updating the sheet you already have

Do this before the new page goes live. The shop code and the web app URL stay the same.

1. Open the Fleet Maintenance Log sheet. **Extensions → Apps Script**.
2. Select all of the script, delete it, and paste in the new `Code.gs`. Do not change `ACCESS_CODE`.
3. In the function dropdown, choose **setup** and click **Run**. Approve the extra permissions for Google Drive (photos). Setup adds any missing tabs and any missing header columns. It does not delete rows or rename anything. A unit that only had the old "PM every" hours or days becomes one PM level, with one task named Scheduled service. The old interval stays on the unit too.
4. **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Do not create a second deployment. The URL does not change.
5. **Project settings** (gear) → set **Time zone** to the plant.
6. In the function dropdown, run **installDailyDigest** and allow Mail plus the permission to install a trigger. Or open the sheet and use **Fleet Maintenance → Install daily reminder (about 6:00)**. That arms a run around 6:00 each morning. Nothing is emailed until someone turns the reminder on in the app.
7. Update `index.html` on GitHub (merge the pull request). Leave the `window.FLEET_SCRIPT_URL` line as it is.

If a save on the phone says the sheet is still on the old script, steps 3 and 4 were missed.

## Photos, checks, PMs, dates, reminders

- **Photos.** On a work order, or on a failed daily-check line, use Camera or Choose photo. The phone shrinks the picture, then the script files it in **Fleet Maintenance Photos** and stores the link on the row. New photos are shared as "anyone with the link" so the crew can see the thumbnail. The link is not listed anywhere public. If the Google account blocks that sharing, the file is still saved for the account that owns the sheet, and the thumbnail on the phone will not load until sharing is allowed.
- **Daily check.** On a unit, Daily check is the pre-shift list for that equipment type. Pass / Fail / N/A, a meter reading, and notes. Any Fail opens one Repair work order with those items in the description. Edit the checklist at the bottom of the form; that list is shared by every unit of the same type.
- **PM schedule.** A unit can have more than one level (250 hours, annual, whichever comes first). Each level has task lines and an optional parts list. Those parts are written onto the service job. They are not a stockroom. **Generate due PMs** opens a Service work order for each task that is due or overdue and does not already have an open job. Due-soon tasks wait.
- **Dates.** Warranty, certification, and registration on the unit use the same due-soon and overdue marks as PM. How many days counts as "due soon" is set under Reminders (30 if you leave it).
- **Hours down.** On the work order, "Hours the unit was down" is the time that job took the unit out of service. The dashboard tile is the total for this week (Monday through today). Reports and the Excel file include it.
- **Approve / Reject.** On a job in Waiting on approval, Approve and Reject are one tap. An optional note is recorded with who and when. Who is the name chosen for this phone. Approve moves the job to Scheduled when it has a due date that is today or later, otherwise to Open. Reject closes it. If the "Requested by" name matches someone on the team, the phone offers a text or email back to them.
- **Daily reminder.** Work orders → Reminders. Turn it on, pick who gets the email, and optionally text them through the carrier on their team card (US 10-digit numbers, email-to-SMS). The message lists PMs that are due or coming up, late work orders, dates inside the warning window, and jobs waiting on approval. **Fleet Maintenance → Send reminder now** sends one immediately. **Remove daily reminder** deletes the trigger. Turning the switch off in the app stops the mail even if the trigger is still installed.

To look at the screens without the shop sheet, open the page with `?sample=1` on the end. That fleet stays in the browser only.

## Changing things later

- **New shop code:** edit `ACCESS_CODE` in Apps Script, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same. Everyone gets asked for the new code.
- **Updating Code.gs:** always redeploy the same way (new version on the existing deployment) so the URL doesn't change. Run **setup** again after pasting. It is safe to run more than once.
- **Your data:** it's all in the Google Sheet. You can sort, filter or total it there, but don't rename the tabs (`units`, `records`, `employees`, `checks`, `levels`, `pmTasks`, `checklists`, `settings`) or the header row. Columns the script does not know about are left in place.
