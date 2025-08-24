// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('llm', {
  ask: (message: string, model: string) =>
    ipcRenderer.invoke('chat:ask', { message, model }),

  stream: (message: string, model: string, onChunk: (s: string) => void) => {
    const onChunkHandler = (_: any, s: string) => onChunk(s);
    const cleanup = () => {
      ipcRenderer.removeListener('chat:chunk', onChunkHandler);
      ipcRenderer.removeAllListeners('chat:done');
      ipcRenderer.removeAllListeners('chat:error');
    };
    ipcRenderer.on('chat:chunk', onChunkHandler);
    ipcRenderer.once('chat:done', cleanup);
    ipcRenderer.once('chat:error', (_: any, e: string) => {
      console.error(e);
      cleanup();
    });

    ipcRenderer.send('chat:stream', { message, model });
  },
});
