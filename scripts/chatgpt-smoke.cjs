const { app, ipcMain } = require('electron');
const path = require('node:path');
const { ChatGptTransport } = require('../src/chatgpt-transport.cjs');

let transport;

ipcMain.on('clippy-chatgpt:event', (event, payload) => transport?.receivePageEvent(event.sender, payload));

app.whenReady().then(async () => {
  transport = new ChatGptTransport({ preloadPath: path.join(__dirname, '..', 'src', 'chatgpt-page-preload.cjs') });
  await transport.start();
  const first = await transport.send({
    text: 'Remember the codeword PAPERSHINE. Reply with exactly: remembered',
    hideFromHistory: true,
  });
  const result = await transport.send({
    text: 'What codeword did I give you? Reply with only the codeword.',
    conversationId: first.conversationId,
    parentMessageId: first.parentMessageId,
    hideFromHistory: true,
  });
  if (first.text.trim().toLowerCase() !== 'remembered' || result.text.trim().toUpperCase() !== 'PAPERSHINE') {
    throw new Error(`Unexpected continuity response: ${JSON.stringify({ first: first.text, second: result.text })}`);
  }
  process.stdout.write(`CHATGPT_SMOKE_OK streamed=true continuity=true conversation=${Boolean(result.conversationId)} parent=${Boolean(result.parentMessageId)}\n`);
  transport.close();
  app.quit();
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  transport?.close();
  app.exit(1);
});
