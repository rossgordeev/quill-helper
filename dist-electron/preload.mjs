"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  askLLM: (message) => electron.ipcRenderer.invoke("chat:ask", message)
});
