import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  askLLM: (message: string) => ipcRenderer.invoke('chat:ask', message),
});
