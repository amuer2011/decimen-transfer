const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("decimenPicker", {
  onSources(callback) {
    ipcRenderer.on("picker:sources", (_event, sources) => callback(sources));
  },
  ready() {
    ipcRenderer.send("picker:ready");
  },
  confirm(sourceId) {
    return ipcRenderer.invoke("picker:confirm", sourceId);
  },
  cancel() {
    return ipcRenderer.invoke("picker:cancel");
  },
});
