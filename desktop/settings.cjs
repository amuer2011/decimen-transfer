const fs = require("node:fs");
const path = require("node:path");

const FIELDS = {
  send: ["fps", "frameBytes", "ecc", "displaySize"],
  receive: ["width", "capFps", "workers"],
};
const hasSection = section => Object.hasOwn(FIELDS, section);
function tuning(section, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(FIELDS[section].filter(key => typeof values[key] === "string" && values[key].length <= 16).map(key => [key, values[key]]));
}

function createSettingsStore(filename) {
  function read() {
    try {
      if (fs.statSync(filename).size > 8192) return {};
      const data = JSON.parse(fs.readFileSync(filename, "utf8"));
      return { send: tuning("send", data?.send), receive: tuning("receive", data?.receive) };
    } catch { return {}; }
  }
  return {
    get(section) { return hasSection(section) ? read()[section] ?? {} : {}; },
    set(section, values) {
      if (!hasSection(section)) return false;
      const data = { ...read(), [section]: tuning(section, values) };
      const temporary = `${filename}.tmp`;
      try {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify(data), "utf8");
        fs.renameSync(temporary, filename);
        return true;
      } catch (error) {
        console.error("Could not save transfer settings:", error.message);
        return false;
      } finally { try { fs.rmSync(temporary, { force: true }); } catch { /* Best effort. */ } }
    },
  };
}

function configureTransferSettings({ app, ipcMain, getWindow }) {
  const store = createSettingsStore(path.join(app.getPath("userData"), "transfer-settings.json"));
  const trusted = event => {
    const window = getWindow();
    return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  };
  ipcMain.on("settings:get", (event, section) => { event.returnValue = trusted(event) ? store.get(section) : {}; });
  ipcMain.on("settings:set", (event, section, values) => { event.returnValue = !!trusted(event) && store.set(section, values); });
}

module.exports = { createSettingsStore, configureTransferSettings };
