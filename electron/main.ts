import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, promises as fs } from 'fs';
import { spawn } from 'child_process';
import https from 'https';
import crypto from 'crypto';

// ---------- CONFIG: set these to your actual files ----------
/**
 * Choose ONE of the two strategies below:
 * 
 * A) SHIP WITH APP (no download): Put files under project ./resources/ and build with electron-builder (see notes below).
 *    - Leave URLs empty; we'll load from resources.
 * 
 * B) DOWNLOAD ON FIRST RUN (smaller installer): Provide URLs + SHA256 for the two files below.
 *    - We'll save to userData and verify checksums.
 */

// llama.cpp server binary (Windows): e.g., CUDA or CPU build .exe
const LLAMA_SERVER_URL = ''; // 'https://example.com/llama-server-cuda-win64.exe'
const LLAMA_SERVER_SHA256 = 'REPLACE_WITH_REAL_SHA256';

// GGUF model (quantized 7B/8B): e.g., Llama-3.1-8B-Instruct-Q4_K_M.gguf
const MODEL_URL = ''; // 'https://example.com/models/llama3.1-8b-instruct-q4_K_M.gguf'
const MODEL_SHA256 = 'REPLACE_WITH_REAL_SHA256';

// Relative paths when shipped inside the app (recommended names)
const RES_BIN_REL = 'resources/llama-server.exe';
const RES_MODEL_REL = 'resources/models/llama3.1-8b-instruct-q4_K_M.gguf';

// Relative paths when downloaded to userData (minimal nesting)
const UD_BIN_REL = 'llama-server.exe';
const UD_MODEL_REL = 'llama-model.gguf';

// llama.cpp runtime params
const SERVER_PORT = 18777;
const CTX_SIZE = 4096;
// ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let win: BrowserWindow | null = null;
let baseUrl = `http://127.0.0.1:${SERVER_PORT}`;

// Small helpers
const isDev = !app.isPackaged;
const appPath = () => (isDev ? process.cwd() : app.getAppPath());
const resPath = (rel: string) => join(appPath(), rel);
const userPath = (rel: string) => join(app.getPath('userData'), rel);

async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256');
  const r = fs.createReadStream(file);
  return await new Promise((resolve, reject) => {
    r.on('data', (d) => h.update(d));
    r.on('end', () => resolve(h.digest('hex')));
    r.on('error', reject);
  });
}

function download(url: string, outFile: string) {
  return new Promise<void>((resolve, reject) => {
    fs.mkdir(dirname(outFile), { recursive: true }).then(() => {
      const file = fs.createWriteStream(outFile);
      https
        .get(url, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // redirect
            file.close(); fs.unlink(outFile).catch(() => {});
            return resolve(download(res.headers.location, outFile));
          }
          if (res.statusCode !== 200) {
            file.close(); fs.unlink(outFile).catch(() => {});
            return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          res.on('error', (e) => reject(e));
        })
        .on('error', reject);
    });
  });
}

async function ensureAssets(): Promise<{ bin: string; model: string }> {
  // 1) Prefer packaged resources (zero download)
  const resBin = resPath(RES_BIN_REL);
  const resModel = resPath(RES_MODEL_REL);
  if (existsSync(resBin) && existsSync(resModel)) {
    return { bin: resBin, model: resModel };
  }

  // 2) Otherwise, download to userData (only if URLs are provided)
  if (!LLAMA_SERVER_URL || !MODEL_URL) {
    const msg =
      'Model/binary not found in app resources and no download URLs provided.\n' +
      'Either ship them in ./resources before building, or set LLAMA_SERVER_URL/MODEL_URL.';
    await dialog.showErrorBox('Assets missing', msg);
    throw new Error(msg);
  }

  const udBin = userPath(UD_BIN_REL);
  const udModel = userPath(UD_MODEL_REL);

  // If they already exist, verify checksum; if mismatch or missing, re-download.
  const needBin = !(existsSync(udBin) && (await safeCheck(udBin, LLAMA_SERVER_SHA256)));
  const needModel = !(existsSync(udModel) && (await safeCheck(udModel, MODEL_SHA256)));

  if (needBin || needModel) {
    const res = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Download', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Download model',
      message: 'Download local model & runtime for offline use?',
      detail:
        'Files will be stored locally and verified by checksum. This is a one-time download.'
    });
    if (res.response !== 0) throw new Error('User canceled download');

    if (needBin) {
      await download(LLAMA_SERVER_URL, udBin);
      if (!(await safeCheck(udBin, LLAMA_SERVER_SHA256))) {
        throw new Error('Checksum failed for llama-server.exe');
      }
    }
    if (needModel) {
      await download(MODEL_URL, udModel);
      if (!(await safeCheck(udModel, MODEL_SHA256))) {
        throw new Error('Checksum failed for model gguf');
      }
    }
  }
  return { bin: udBin, model: udModel };
}

async function safeCheck(file: string, expectedSha: string) {
  try {
    const sum = await sha256File(file);
    return !!expectedSha && sum.toLowerCase() === expectedSha.toLowerCase();
  } catch {
    return false;
  }
}

async function startLlamaServer(bin: string, model: string): Promise<void> {
  // Ensure executable bit on non-Windows (no-op on Windows)
  try { await fs.chmod(bin, 0o755); } catch {}

  const args = [
    '-m', model,
    '--port', String(SERVER_PORT),
    '--host', '127.0.0.1',
    '--ctx-size', String(CTX_SIZE),
    '--api',
  ];

  const proc = spawn(bin, args, { windowsHide: true, stdio: 'ignore' });
  proc.on('exit', (code) => console.log('llama-server exited', code));

  // Wait until /v1/models responds
  await waitReady(`${baseUrl}/v1/models`, 20_000);
}

function waitReady(url: string, timeoutMs: number) {
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tryOnce = () => {
      const req = https.request(url, { method: 'GET' }, (res) => {
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

// --- OpenAI-compatible streaming against local llama.cpp ---
async function* llamaCppStream(messages: Array<{ role: string; content: string }>) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'local', messages, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`llama.cpp HTTP ${res.status}`);

  const reader = (res as any).body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const json = s.slice(5).trim();
      if (json === '[DONE]') return;
      try {
        const obj = JSON.parse(json);
        const delta = obj.choices?.[0]?.delta?.content || '';
        if (delta) yield delta;
      } catch {}
    }
  }
}

async function createWindow() {
  const devUrl = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL;

  win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(join(__dirname, '../dist/index.html'));
  }

  win.on('closed', () => (win = null));
}

app.whenReady().then(async () => {
  try {
    const { bin, model } = await ensureAssets();
    await startLlamaServer(bin, model);
  } catch (e) {
    console.error('Startup error:', e);
    await dialog.showErrorBox('Startup error', String(e));
  }

  // IPC: non-streaming (kept for compatibility if you still call invoke)
  ipcMain.handle('chat:ask', async (_e, { message }) => {
    try {
      // simple non-streaming call (just for completeness)
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'local',
          messages: [
            { role: 'system', content: 'You are a concise, helpful assistant.' },
            { role: 'user', content: message },
          ],
          stream: false,
        }),
      });
      return await res.json();
    } catch (err) {
      return { error: String(err) };
    }
  });

  // IPC: streaming
  ipcMain.on('chat:stream', async (e, { message }) => {
    try {
      for await (const chunk of llamaCppStream([
        { role: 'system', content: 'You are a concise, helpful assistant.' },
        { role: 'user', content: message },
      ])) {
        e.sender.send('chat:chunk', chunk);
      }
      e.sender.send('chat:done');
    } catch (err) {
      e.sender.send('chat:error', String(err));
    }
  });

  await createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
