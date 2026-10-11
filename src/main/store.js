const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// A JSON file in the user's profile directory, written back shortly after
// each change.
class JsonStore {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), `${name}.json`);
    this.data = defaults;
    this.timer = null;
    try {
      const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(defaults)) {
        if (Array.isArray(loaded)) this.data = loaded;
      } else if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        this.data = { ...defaults, ...loaded };
      }
    } catch {
      // Missing or unreadable file: start from the defaults.
    }
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    try {
      const tmp = `${this.file}.tmp`;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`Could not save ${this.file}:`, err.message);
    }
  }
}

module.exports = JsonStore;
