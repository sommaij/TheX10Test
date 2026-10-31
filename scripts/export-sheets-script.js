// Writes integrations/google-sheets/TaskFlow.gs from the same template the app shows (npm run sheets-script).
const fs = require('fs');
const path = require('path');
const { taskflowScript } = require('../public/js/sheets-script.js');

const out = path.join(__dirname, '..', 'integrations', 'google-sheets', 'TaskFlow.gs');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, taskflowScript({ url: 'https://taskflow.thex10smile.com', doneStatus: 'DONE' }));
console.log('wrote', path.relative(process.cwd(), out));
