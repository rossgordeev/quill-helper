"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("llm", {
  ask: (message, model) => electron.ipcRenderer.invoke("chat:ask", { message, model }),
  stream: (message, model, onChunk) => {
    const onChunkHandler = (_, s) => onChunk(s);
    const cleanup = () => {
      electron.ipcRenderer.removeListener("chat:chunk", onChunkHandler);
      electron.ipcRenderer.removeAllListeners("chat:done");
      electron.ipcRenderer.removeAllListeners("chat:error");
    };
    electron.ipcRenderer.on("chat:chunk", onChunkHandler);
    electron.ipcRenderer.once("chat:done", cleanup);
    electron.ipcRenderer.once("chat:error", (_, e) => {
      console.error(e);
      cleanup();
    });
    electron.ipcRenderer.send("chat:stream", { message, model });
  }
});
