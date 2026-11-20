# PairLift — Powerlifting Training Block Tracker

A mobile-first, **offline-capable Progressive Web App (PWA)** for running structured powerlifting training blocks, following daily strength target curves, tracking weekly stats, and exporting shareable progress cards for Instagram and WhatsApp.

## Features

- **Offline-First Local Storage (UUID + Versioned JSON)**: Runs 100% locally in your phone's browser (`schema_version: 1`) with zero server required — and supports 1-tap JSON Backup Export/Import plus drop-in compatibility with the included FastAPI + SQLite backend (`backend/`).
- **Training Blocks**: Create blocks (e.g., 14 weeks) defaulting to Squat, Bench, and Deadlift, with optional extra lifts (OHP, Pullup, Row, or custom) and bodyweight tracking.
- **5 Progression Setups**:
  - **Linear Target Curve**: Exact `Start → Goal` daily interpolation with plate rounding (`2.5 kg` / `1.25 kg` / `0.1 kg` for bodyweight), matching spreadsheet `MROUND(FORECAST(...))` math.
  - **5/3/1 Waves**: 4-week wave percentages (5s / 3s / 5-3-1 / Deload) with automatic Training Max bumps per cycle.
  - **1RM Everyday (Bulgarian)**: Daily minimum floor + stretch daily max targets.
  - **GZCLP / Double Progression**: Weekly step loading with customizable rep schemes.
  - **Custom Weekly Milestones**: Week-by-week explicit target weights.
- **Hybrid Workout Logging**: Quick working weight + optional 1RM entry, or expand **Sets × Reps** to log every set and auto-calculate **Epley Estimated 1RM** and volume.
- **Weekly Check-In & Interactive Charts**: Weekly hit/miss rates, PRs, streaks, and interactive Target-vs-Actual (+ 1RM overlay) SVG charts.
- **Themes**: Switch between **Coral Dark**, **Blue**, and **Pink**.
- **Share Progress Cards (Instagram / WhatsApp)**: Generate high-resolution **Story (9:16)** or **Square (1:1)** PNG cards in Block Summary or Lift Spotlight mode, with 1-tap native Share, PNG Download, or Copy Image.

---

## Deploy Free to GitHub Pages (Android + iOS HTTPS)

This repository includes `.github/workflows/pages.yml` so GitHub Pages automatically deploys the `frontend/` PWA:

```bash
git init -b main
git add .
git commit -m "Initial PairLift PWA"
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
git push -u origin main
```

Then on GitHub:
1. Open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Wait ~30 seconds for the workflow to finish — your live HTTPS URL will be `https://<YOUR_USERNAME>.github.io/<YOUR_REPO>/`.

### Install on Your Phones
- **Android (Chrome):** Open the GitHub Pages URL → **⋮ → Add to Home screen → Install**.
- **iOS (Safari):** Open the GitHub Pages URL in **Safari** → **Share → Add to Home Screen → Add**.

---

## Optional: Run Local Python Server & Tests

```bash
./start.sh
.venv/bin/pytest -v
```
