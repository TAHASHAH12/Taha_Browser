// Renders build/icon.svg to build/icon.png (1024x1024). Run: npm run icon
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZE = 1024;
const buildDir = path.join(__dirname, '..', 'build');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(buildDir, 'icon.svg'));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE });
  fs.writeFileSync(path.join(buildDir, 'icon.png'), image.toPNG());
  app.quit();
});
