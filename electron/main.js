const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'GPXtruder Modern',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });

    mainWindow.loadFile('index.html');

    // Mostrar janela quando estiver pronta (evita flash branco)
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Menu simplificado
    const menu = Menu.buildFromTemplate([
        {
            label: 'Arquivo',
            submenu: [
                { label: 'Recarregar', accelerator: 'F5', click: () => mainWindow.reload() },
                { type: 'separator' },
                { label: 'Sair', accelerator: 'Alt+F4', click: () => app.quit() }
            ]
        },
        {
            label: 'Visualizar',
            submenu: [
                { label: 'Tela Cheia', accelerator: 'F11', click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
                { label: 'Ferramentas de Desenvolvedor', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
                { type: 'separator' },
                { label: 'Aumentar Zoom', accelerator: 'CmdOrCtrl+=', click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5) },
                { label: 'Diminuir Zoom', accelerator: 'CmdOrCtrl+-', click: () => mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5) },
                { label: 'Zoom Padrão', accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.setZoomLevel(0) }
            ]
        }
    ]);
    Menu.setApplicationMenu(menu);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});
