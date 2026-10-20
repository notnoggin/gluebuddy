# Gluepod

Leave a visual workflow pod (note, checklist, link, or file) on the work in front of you. Come back, and it is still there — with clearer marks, previews, and a holding shelf than pure context notes.

Fully offline. No account. No cloud.

## Quick start (Windows, non-technical)

1. Download this repo as a ZIP from GitHub and extract it.
2. One-time setup (only needed once):
   ```
   npm install
   npm i -D electron-builder
   ```
3. To run immediately:
   ```
   npm start
   ```
   Or double-click `Gluepod.vbs`.
4. To create a real installer (so other people can just download and run):
   ```
   npm run dist
   ```
   The installer appears in the `dist/` folder. Share that `.exe`.

## Mac

Build must be done on a Mac:
```
npm run dist:mac
```

## What it does

- Notes, checklists, links, and files attached to the app / project / ticker you are in.
- On Mac it lives in the notch (hover the top center).
- Alt+A (Windows) or ⌥A (Mac) opens the compact panel.
- Minimize button so you do not have to fully close it.
- History is a visual card grid.
- Settings: appearance (light/dark/system), return nudge, start at login. Account placeholder for future Whop.

## Differentiation

Visual workflow pods + structured marks (Ship, Follow-up, Decision, Level) + holding shelf. Cuewake is the pure “leave a thought.” Gluepod is the visual companion for makers.
