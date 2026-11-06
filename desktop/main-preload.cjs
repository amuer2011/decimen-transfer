const { contextBridge, ipcRenderer } = require("electron");
let activityGuard = () => false;

ipcRenderer.on("updates:activity-request", (_event, id) => {
  let busy = true;
  try { busy = !!activityGuard(); } catch { /* Fail closed if the guard fails. */ }
  ipcRenderer.send("updates:activity", { id, busy });
});

contextBridge.exposeInMainWorld("decimenUpdates", {
  getStatus: () => ipcRenderer.invoke("updates:status"),
  check: () => ipcRenderer.invoke("updates:check"),
  download: () => ipcRenderer.invoke("updates:download"),
  install: () => ipcRenderer.invoke("updates:install"),
  setActivityGuard(guard) { if (typeof guard === "function") activityGuard = guard; },
  onStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("updates:status", listener);
    return () => ipcRenderer.removeListener("updates:status", listener);
  },
  onAbout(callback) {
    const listener = () => callback();
    ipcRenderer.on("updates:about", listener);
    return () => ipcRenderer.removeListener("updates:about", listener);
  },
});

contextBridge.exposeInMainWorld("decimenAppearance", {
  getTheme: () => ipcRenderer.sendSync("appearance:get"),
  setTheme: (theme) => ipcRenderer.send("appearance:set", theme),
});

contextBridge.exposeInMainWorld("decimenSettings", {
  get: section => ipcRenderer.sendSync("settings:get", section),
  set: (section, values) => ipcRenderer.sendSync("settings:set", section, values),
});

contextBridge.exposeInMainWorld("decimenDesktop", {
  onDownloadCompleted(callback) {
    ipcRenderer.once("downloads:completed", () => callback());
  },
  openTargetFolder() {
    return ipcRenderer.invoke("downloads:open-folder");
  },
});
