// Renders the in-app widget previews to the images Android shows in its widget picker.
//   npm run build:demo -- /tmp/x10-demo.html && node scripts/make-widget-previews.js /tmp/x10-demo.html
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const demo = path.resolve(process.argv[2] || path.join(root, 'dist', 'demo.html'));
const page = path.join(os.tmpdir(), `x10-widget-preview-${process.pid}.html`);
fs.writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${fs.readFileSync(demo, 'utf8')}</body></html>`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2.5, colorScheme: 'light', locale: 'th-TH' });
  const p = await ctx.newPage();
  await p.goto('file://' + page + '#options');
  await p.waitForTimeout(1200);
  await p.addStyleTag({ content: '.wallpaper{background:none!important;padding:0!important}.hw{box-shadow:none!important}#toast-root{display:none!important}' });
  const out = path.join(root, 'android', 'res', 'drawable-nodpi');
  fs.mkdirSync(out, { recursive: true });
  await p.locator('.hw-summary').screenshot({ path: path.join(out, 'widget_preview_summary.png'), omitBackground: true });
  await p.locator('.hw-list').screenshot({ path: path.join(out, 'widget_preview_list.png'), omitBackground: true });
  await browser.close();
  fs.unlinkSync(page);
  console.log('wrote android/res/drawable-nodpi/widget_preview_{summary,list}.png');
})();
