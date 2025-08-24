import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { join } from 'node:path';
import { app } from 'electron';

function getResourcesBase() {
  // In dev, use project root; in prod, use app path (ASAR-unpacked recommended)
  const isDev = !app.isPackaged;
  return isDev ? process.cwd() : app.getAppPath();
}

async function waitReady(url: string, timeoutMs: number) {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request(url, (res) => {
        if ((res.statusCode ?? 500) < 500) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('Server not ready (5xx)'));
        setTimeout(tryOnce, 300);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('Server not reachable'));
        setTimeout(tryOnce, 300);
      });
      req.end();
    };
    tryOnce();
  });
}

export type LlamaServerHandle = {
  url: string;
  stop: () => void;
  proc: ChildProcessWithoutNullStreams;
};

export async function startLlamaServer(
  opts?: {
    port?: number;
    ctxSize?: number;
    modelRelPath?: string;   // relative to /resources
    binRelPath?: string;     // relative to /resources
  }
): Promise<LlamaServerHandle> {
  const port = opts?.port ?? 18777;
  const ctxSize = opts?.ctxSize ?? 4096;

  const base = getResourcesBase();
  const resourcesDir = join(base, 'resources');
  const bin = join(resourcesDir, opts?.binRelPath ?? 'llama-server.exe');
  const model = join(resourcesDir, opts?.modelRelPath ?? 'models/llama3.1-8b-instruct-q4_K_M.gguf');

  const args = [
    '-m', model,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--ctx-size', String(ctxSize),
    '--api' // OpenAI-compatible REST endpoints (/v1/*)
  ];

  const proc = spawn(bin, args, { windowsHide: true, stdio: 'ignore' });
  // You can switch to 'inherit' stdio for debugging to see server logs.

  proc.on('exit', (code) => {
    console.log('llama-server exited', code);
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitReady(`${baseUrl}/v1/models`, 20000);
  return {
    url: baseUrl,
    stop: () => { try { proc.kill(); } catch {} },
    proc
  };
}
