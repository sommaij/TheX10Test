// Renders public/icons/icon.svg to the PNGs the web manifest and the Android app need. Needs Playwright:
//   npx playwright install chromium   (once)   then   npm run icons
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'public', 'icons', 'icon.svg'), 'utf8');
// Maskable icons need a full-bleed square background with the artwork inside the 80% safe zone;
// launchers cut their own shape. Widen the viewBox by 10% per side and square off the backdrop.
const maskable = svg
  .replace('viewBox="0 0 512 512"', 'viewBox="-51 -51 614 614"')
  .replace(/<rect width="512" height="512" rx="\d+"/, '<rect x="-51" y="-51" width="614" height="614"');
// Android adaptive icon foreground: artwork only, 512 units shown as 80dp of the 108dp canvas.
const foreground = svg
  .replace('viewBox="0 0 512 512"', 'viewBox="-89.6 -89.6 691.2 691.2"')
  .replace(/<rect width="512" height="512" rx="\d+" fill="[^"]+"\/>/, '');

const web = path.join(root, 'public', 'icons');
const res = path.join(root, 'android', 'res');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const shots = [
  [path.join(web, 'icon-192.png'), svg, 192],
  [path.join(web, 'icon-512.png'), svg, 512],
  [path.join(web, 'maskable-512.png'), maskable, 512],
];
for (const [d, k] of Object.entries(densities)) {
  shots.push([path.join(res, `mipmap-${d}`, 'ic_launcher.png'), svg, 48 * k]);
  shots.push([path.join(res, `mipmap-${d}`, 'ic_launcher_fg.png'), foreground, 108 * k]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, markup, size] of shots) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.locator('svg').screenshot({ path: file, omitBackground: true });
    console.log('wrote', path.relative(root, file));
  }
  await browser.close();
})();
