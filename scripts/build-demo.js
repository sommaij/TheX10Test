// Bundles the app into one self-contained HTML file (no server, data stays in the browser).
// Used for the shareable preview: `npm run build:demo -- out/demo.html`
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'demo.html'));
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const between = (a, b) => html.slice(html.indexOf(a) + a.length, html.indexOf(b)).trim();

const title = html.match(/<title>[^<]*<\/title>/)[0];
const fonts = between('<!-- FONTS:START -->', '<!-- FONTS:END -->');
const body = between('<!-- BODY:START -->', '<!-- BODY:END -->');
const css = fs.readFileSync(path.join(pub, 'css', 'app.css'), 'utf8');
const js = ['shared.js', 'app.js'].map((f) => fs.readFileSync(path.join(pub, 'js', f), 'utf8')).join('\n');

const page = `${title}
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}
</style>
${body}
<script>window.X10_DEMO = true;</script>
<script>
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
