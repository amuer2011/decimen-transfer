const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("decimenDesktop", {
  onDownloadCompleted(callback) {
    ipcRenderer.once("downloads:completed", () => callback());
  },
  openTargetFolder() {
    return ipcRenderer.invoke("downloads:open-folder");
  },
});
