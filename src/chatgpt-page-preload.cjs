const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clippyChatGptHost', {
  emit: (requestId, event) => ipcRenderer.send('clippy-chatgpt:event', { requestId, event }),
});
