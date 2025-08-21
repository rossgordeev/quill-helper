import { app, BrowserWindow, ipcMain } from 'electron'
import path, { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { OllamaChat } from './llm.ts' 

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: join(__dirname, 'preload.js'), 
    },
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('chat:ask', async (_event, message: string) => {
  try {
    const response = await OllamaChat(message)
    return response
  } catch (err) {
    console.error(err)
    return { error: String(err) }
  }
})
