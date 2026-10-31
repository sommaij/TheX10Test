// Renders public/icons/icon.svg to the PNG sizes the manifest needs. Needs Playwright:
//   npx playwright install chromium   (once)   then   npm run icons
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dir = path.join(__dirname, '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
// Maskable icons need a full-bleed square background with the artwork inside the 80% safe zone;
// launchers cut their own shape. Widen the viewBox by 10% per side and square off the backdrop.
const maskable = svg
  .replace('viewBox="0 0 512 512"', 'viewBox="-51 -51 614 614"')
  .replace(/<rect width="512" height="512" rx="\d+"/, '<rect x="-51" y="-51" width="614" height="614"');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shots = [
    ['icon-192.png', svg, 192],
    ['icon-512.png', svg, 512],
    ['maskable-512.png', maskable, 512],
  ];
  for (const [name, markup, size] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
    await page.locator('svg').screenshot({ path: path.join(dir, name), omitBackground: true });
    console.log('wrote', name);
  }
  await browser.close();
})();
