const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// el audio debe poder arrancar sin fricción en la app de escritorio
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const smoke = !!process.env.CRATER_SMOKE;
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: !smoke,
    backgroundColor: '#0b0e15',
    title: 'CRATER',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  // los enlaces externos se abren en el navegador, nunca dentro del juego
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // prueba de humo para CI: arranca oculto, confirma que carga y sale
  if (smoke) {
    win.webContents.once('did-finish-load', () => {
      console.log('SMOKE_OK');
      app.quit();
    });
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      console.error('SMOKE_FAIL', code, desc);
      app.exit(1);
    });
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
