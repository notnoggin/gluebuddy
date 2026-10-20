# Gluebuddy

Stick notes, links, code, images and files to any app on Windows. Find them when you're back.

Press **Ctrl+Shift+Space** anywhere. Gluebuddy notices which app you were in, shows what's stuck to it, and lets you stick something new. Switch to an app that has things stuck to it and you get a quiet notification.

Everything is stored locally in your user data folder. No account, no network.

## Run it

```
npm install
node node_modules/electron/install.js   # only needed if npm blocks Electron's install script
npm start
```

Double-click `Gluebuddy.vbs` to start it without a terminal. Right-click the tray icon and tick "Start with Windows" to launch it at login.

## Build an installer

```
npm i -D electron-builder
npm run dist
```

The installer lands in `dist/`. Not tested yet: check that app detection (`active-win`) still works in the packaged build.

## Layout

- `main.js`: window, tray, hotkey, app detection, notifications
- `renderer.js` and `index.html`: the interface
- `fonts/`: Inter and JetBrains Mono (SIL Open Font License), bundled so it works offline
- `icon.png`, `icon.ico`, `tray.png`: the buddy

## License

Not chosen yet. Decide before publishing.
