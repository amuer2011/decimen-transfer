const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("decimenAppearance", {
  getTheme: () => ipcRenderer.sendSync("appearance:get"),
  setTheme: (theme) => ipcRenderer.send("appearance:set", theme),
});

contextBridge.exposeInMainWorld("decimenDesktop", {
  onDownloadCompleted(callback) {
    ipcRenderer.once("downloads:completed", () => callback());
  },
  openTargetFolder() {
    return ipcRenderer.invoke("downloads:open-folder");
  },
});
