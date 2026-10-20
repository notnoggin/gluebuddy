# Gluebuddy

Leave a note, checklist, link, or file on the work in front of you. Come back, and it is still there.

Press **Alt A** on Windows, or **⌥ A** on a Mac. A panel opens over whatever you are doing, already aimed at that app, project, or ticker. History is a separate window: everything you have left, across every app.

On a Mac, Gluebuddy also lives in the notch. Hover the top center of the screen and the same panel drops down. A small count peeks out when something is waiting. Drag files onto the notch and they sit on the shelf until you need them. There is no notch on Windows, so Alt A opens that same panel from the top of the screen.

Everything stays on this computer. No account, no network.

## Leave something

- **Note.** A thought. Start with “tomorrow”, “tonight”, “in 2 hours”, or “next week” and it comes back then. Tab finishes a line you have written before.
- **Checklist.** Steps you tick off when you return. The last step moves it to Done. Reuse copies it with the steps clear again.
- **Link.** Copy a URL, then press Alt A. Gluebuddy is already in Link mode.
- **File.** Drop files, paste screenshots, or browse. Several files stay on one cue. Drag a file back out into another app.

**Ship**, **Follow up**, **Decision**, and **Level** are optional marks. Level is there for a chart or a ticker. Ship, follow up, and decision are there for the rest of the work.

**When** sets a return time. **Waiting**, **Later**, and **Done** narrow the list. Search covers the words, the link, the file, and the project.

**Holding** is a shelf. Drop files on it, drag them into another app, or attach them to the place you are in. The original files stay where they are.

The panel follows the app, and when it can, the project or the symbol in the window title. A note on one Framer project, repo, or ticker does not get mixed in with the next one. **App** widens that. **All** is everything.

## History

History is the long view: due, waiting, upcoming, and done, with every app down the side. Open it from the panel, or from the tray icon. Ctrl Z (⌘ Z on a Mac) puts back the last cue you removed.

## Run it

```
npm install
node node_modules/electron/install.js   # only if npm skipped Electron's install script
npm start
```

Double-click `Gluebuddy.vbs` to start it without a terminal. It sits in the tray. Right-click the tray icon for History, the return nudge, and start at login.

Esc hides the panel. Alt A hides it again. Closing the panel does the same. Quit from the tray.

## Build

```
npm i -D electron-builder
npm run dist
```

The Windows installer lands in `dist/`. A Mac disk image has to be built on a Mac:

```
npm run dist:mac
```

App detection (`active-win`) still needs a check in the packaged build. On a Mac, dropping files on the notch and Quick Look need a real machine too.

## Layout

- `main.js`: panel, history, notch, tray, shortcut, notifications
- `notch.html`: the Mac notch hover target
- `logic.js`: cues, reminders, projects, tickers
- `renderer.js` and `index.html`: the interface
- `fonts/`: Inter and JetBrains Mono (SIL Open Font License)
- `icon.png`, `icon.ico`, `tray.png`: the mark

## License

Not chosen yet. Decide before publishing.
