# Cutline

A local-first personal fitness dashboard for tracking nutrition, workouts, body measurements, and progress toward a goal.

## Run locally

From this folder, run:

```sh
python -m http.server 5173
```

Open **http://localhost:5173** in a modern browser. Cutline is now a static local-first tracker; no API key or backend is required.

## Deploy on Render

Create a **Static Site** from the repository. Use the project root as the publish directory and leave the build command empty. GitHub Pages, Netlify, and Vercel can also host this static version.

## Your data and backups

Logs and settings are stored in this browser's local storage. They are not an account, a cloud backup, or a cross-device sync service. Other browsers, profiles, devices, and site addresses have separate storage; changing the port also changes the storage location. Use the same address when returning.

Clearing site data, removing a browser profile, or erasing app data can permanently remove your records. Private browsing usually discards data when the session ends, and browser storage restrictions or quotas may prevent saving. Local storage is not encrypted by the app; anyone with access to your browser profile may be able to read it.

Use **Settings → Download backup** regularly and before clearing data. Keep the downloaded file somewhere safe outside the browser and check that it contains your latest records. Exports can contain personal health information. Keep an untouched backup before making changes to exported files.

The app's files run locally. Google Fonts is requested for typography when internet access is available; system fonts are used as a fallback.

## Calorie estimates and intended use

Cutline is intended for generally healthy adults who want a personal tracking tool. It is not a medical device or a prescription for weight loss.

The **Mifflin–St Jeor equation** estimates resting energy expenditure from profile information. An activity multiplier estimates total daily energy expenditure, and a selected goal may adjust the calorie target. These are starting estimates, **not exact calorie requirements**. Individual physiology, activity, logging accuracy, and changes over time affect actual needs. Trend projections are estimates too; weight fluctuates and progress is not linear.

Review targets against your longer-term trends, energy, recovery, and health rather than treating any one daily reading as a verdict. This tool is not designed to set calorie targets for children, pregnancy or breastfeeding, eating-disorder recovery, or medical conditions that affect nutrition. In those situations, seek individualized guidance from a qualified clinician or registered dietitian.

## Project files

- `index.html` — dashboard structure
- `styles.css` — responsive dashboard and form styling
- `app.js` — application behavior and browser persistence
