const { app, BrowserWindow, shell, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let server;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

function rootDir() { return path.resolve(__dirname, '..'); }
function safePath(urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const absolute = path.resolve(rootDir(), relative);
  return absolute.startsWith(rootDir()) ? absolute : null;
}
function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const file = safePath(req.url);
      if (!file) { res.writeHead(403); return res.end('Forbidden'); }
      fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        fs.createReadStream(file).pipe(res);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1500, height: 960, minWidth: 1180, minHeight: 760,
    backgroundColor: '#f2efe6', title: 'Matcha Bar Workspace', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, devTools: !app.isPackaged }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(`http://127.0.0.1:${port}/`)) { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (server) server.close(); });