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
6. In the function dropdown at the top, choose **setup** and click **Run**. Google asks you to authorize it: choose your account → **Advanced** → **Go to (project name)** → **Allow**. Two tabs, `units` and `records`, appear in your sheet.

## 2. Publish it as a web app

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**.
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" lets the page reach the script. The shop code is what keeps strangers from reading or changing your records.

## 3. Put the app on GitHub

1. Sign in to github.com as **chbtools** and click **New repository**. Name it `fleet-maintenance`, set it to **Public**, and click **Create repository**.
2. Click **uploading an existing file** and upload `index.html`, `Code.gs` and `README.md`. Click **Commit changes**.
3. Open `index.html` in the repo and click the pencil (Edit). Find this line near the top:

   ```
   window.FLEET_SCRIPT_URL = "PASTE_YOUR_WEB_APP_URL_HERE";
   ```

   Replace `PASTE_YOUR_WEB_APP_URL_HERE` with the web app URL from step 2. Keep the quotes. Commit.
4. Go to **Settings → Pages**. Under "Branch," choose **main** and **/ (root)**, then **Save**.
5. After a minute or two the app is live at:

   **https://chbtools.github.io/fleet-maintenance/**

## 4. Give it to your team

Send them the link and the shop code. On a phone they can use **Add to Home Screen** so it opens like an app.

## Excel workbook

Tap **Excel** on the Fleet tab, or **Excel (all data)** on the Reports tab, to download every unit and job as an Excel file. It has three tabs:

- **Dashboard** — units, units down, open jobs, spend this month, year to date and all time; cost by unit; and cost by month for the last 12 months.
- **Work Log** — every job, with filter arrows on each column.
- **Units** — the fleet list with status and PM status.

The Dashboard totals are formulas, so they update if you add or fix rows in the Work Log tab.

## Changing things later

- **New shop code:** edit `ACCESS_CODE` in Apps Script, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same. Everyone gets asked for the new code.
- **Updating Code.gs:** always redeploy the same way (new version on the existing deployment) so the URL doesn't change.
- **Your data:** it's all in the Google Sheet. You can sort, filter or total it there, but don't rename the tabs or the header row.
