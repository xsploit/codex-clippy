const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexClippy', {
  getState: () => ipcRenderer.invoke('clippy:get-state'),
  getSettings: () => ipcRenderer.invoke('clippy:get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('clippy:set-settings', settings),
  send: (payload) => ipcRenderer.invoke('clippy:send', payload),
  getComposerOptions: (mode) => ipcRenderer.invoke('clippy:get-composer-options', mode),
  setComposerSettings: (mode, settings) => ipcRenderer.invoke('clippy:set-composer-settings', mode, settings),
  pickFiles: () => ipcRenderer.invoke('clippy:pick-files'),
  savePastedFile: (payload) => ipcRenderer.invoke('clippy:save-pasted-file', payload),
  previewLocalImage: (filePath) => ipcRenderer.invoke('clippy:preview-local-image', filePath),
  stop: () => ipcRenderer.invoke('clippy:stop'),
  transcribe: (audio, mimeType) => ipcRenderer.invoke('clippy:transcribe', audio, mimeType),
  startTranscription: () => ipcRenderer.invoke('clippy:transcription-start'),
  appendTranscriptionAudio: (audio, sampleRate, samplesPerChannel) => ipcRenderer.invoke('clippy:transcription-audio', audio, sampleRate, samplesPerChannel),
  stopTranscription: () => ipcRenderer.invoke('clippy:transcription-stop'),
  cancelTranscription: () => ipcRenderer.invoke('clippy:transcription-cancel'),
  newChat: () => ipcRenderer.invoke('clippy:new-chat'),
  listChats: () => ipcRenderer.invoke('clippy:list-chats'),
  getChat: (threadId) => ipcRenderer.invoke('clippy:get-chat', threadId),
  switchChat: (threadId) => ipcRenderer.invoke('clippy:switch-chat', threadId),
  setMode: (mode) => ipcRenderer.invoke('clippy:set-mode', mode),
  respond: (payload) => ipcRenderer.invoke('clippy:respond', payload),
  openExternal: (url) => ipcRenderer.invoke('clippy:open-external', url),
  hide: () => ipcRenderer.send('clippy:hide'),
  quit: () => ipcRenderer.send('clippy:quit'),
  getWindowPosition: () => ipcRenderer.invoke('window:get-position'),
  setWindowPosition: (x, y) => ipcRenderer.send('window:set-position', { x, y }),
  setIgnoreMouse: (ignore) => ipcRenderer.send('window:set-ignore-mouse', Boolean(ignore)),
  onEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('clippy:event', listener);
    return () => ipcRenderer.removeListener('clippy:event', listener);
  },
});
