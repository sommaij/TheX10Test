'use strict';
// Start: `npm start` (or `node server/index.js`). Options via environment variables:
//   PORT=8080  HOST=0.0.0.0  DATA_DIR=./data  X10_TIMEZONE=Asia/Bangkok  X10_ADMIN_KEY=<your key>
// `node server/index.js --new-admin-key` prints a fresh admin key (use it if you lose yours).
const os = require('os');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';

const app = createApp();

if (process.argv.includes('--new-admin-key')) {
  const { secret } = app.store.createKey({ name: 'ผู้ดูแล (สร้างใหม่)', role: 'admin' });
  console.log(`\nNew admin key:\n\n  ${secret}\n`);
  app.close().then(() => process.exit(0));
  return;
}

app.server.listen(port, host, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\nX10 Tasks is running');
  console.log(`  On this computer:  http://localhost:${port}`);
  for (const ip of lan) console.log(`  On your phone:     http://${ip}:${port}  (same Wi-Fi)`);
  console.log(`  API:               http://localhost:${port}/api/v1`);
  if (app.bootstrapSecret) {
    console.log('\nAdmin key (shown once — keep it safe, the app asks for it when you connect):\n');
    console.log(`  ${app.bootstrapSecret}\n`);
  }
});

function shutdown() {
  app.close().then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
