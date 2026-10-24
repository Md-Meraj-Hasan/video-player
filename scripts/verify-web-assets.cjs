const fs = require('fs');
const path = require('path');

const roots = process.argv.slice(2);
if (!roots.length) roots.push('dist');
let failed = false;
for (const root of roots) {
  const htmlFiles = ['index.html', 'video-player.html'];
  for (const htmlName of htmlFiles) {
    const indexPath = path.join(root, htmlName);
    if (!fs.existsSync(indexPath)) {
      console.error(`[asset-check] Missing ${indexPath}`);
      failed = true;
      continue;
    }
    const html = fs.readFileSync(indexPath, 'utf8');
    const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(m => m[1])
      .filter(ref => !/^(?:https?:|data:|#|\/\/)/i.test(ref));
    if (!refs.some(ref => /\.js(?:\?|$)/i.test(ref))) {
      console.error(`[asset-check] ${indexPath} has no local JavaScript bundle reference`);
      failed = true;
    }
    if (!refs.some(ref => /\.css(?:\?|$)/i.test(ref))) {
      console.error(`[asset-check] ${indexPath} has no local CSS reference`);
      failed = true;
    }
    for (const ref of refs) {
      const clean = decodeURIComponent(ref.split('?')[0]);
      const filePath = path.resolve(root, path.dirname(htmlName), clean);
      if (!filePath.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(filePath)) {
        console.error(`[asset-check] ${indexPath} references missing asset: ${ref}`);
        failed = true;
      }
    }
    if (!failed) console.log(`[asset-check] OK: ${indexPath} references existing local JS/CSS assets`);
  }
}
if (failed) process.exit(1);
