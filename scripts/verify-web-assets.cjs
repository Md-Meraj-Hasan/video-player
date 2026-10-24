const fs = require('fs');
const path = require('path');

const roots = process.argv.slice(2);
if (!roots.length) roots.push('dist');

let hasError = false;

for (const root of roots) {
  const htmlFiles = ['index.html', 'video-player.html'];
  
  for (const htmlName of htmlFiles) {
    const indexPath = path.join(root, htmlName);
    let fileFailed = false;

    // 1. Check if HTML file exists in dist
    if (!fs.existsSync(indexPath)) {
      console.error(`[asset-check] Missing ${indexPath}`);
      hasError = true;
      continue;
    }

    const html = fs.readFileSync(indexPath, 'utf8');

    // 2. Extract all local src and href references
    const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(m => m[1])
      .filter(ref => !/^(?:https?:|data:|#|\/\/)/i.test(ref));

    // 3. Verify JavaScript bundle reference exists (.js)
    if (!refs.some(ref => /\.js(?:\?|$)/i.test(ref))) {
      console.error(`[asset-check] ${indexPath} has no local JavaScript bundle reference`);
      fileFailed = true;
      hasError = true;
    }

    // 4. Verify CSS stylesheet reference exists (.css)
    if (!refs.some(ref => /\.css(?:\?|$)/i.test(ref))) {
      console.error(`[asset-check] ${indexPath} has no local CSS reference`);
      fileFailed = true;
      hasError = true;
    }

    // 5. Verify every referenced asset actually exists on disk inside dist
    for (const ref of refs) {
      const clean = decodeURIComponent(ref.split('?')[0]);
      const filePath = path.resolve(root, path.dirname(htmlName), clean);

      if (!filePath.startsWith(path.resolve(root) + path.sep) && filePath !== path.resolve(root)) {
        console.error(`[asset-check] ${indexPath} references out-of-root asset: ${ref}`);
        fileFailed = true;
        hasError = true;
      } else if (!fs.existsSync(filePath)) {
        console.error(`[asset-check] ${indexPath} references missing asset: ${ref}`);
        fileFailed = true;
        hasError = true;
      }
    }

    if (!fileFailed) {
      console.log(`[asset-check] OK: ${indexPath} references existing local JS/CSS assets`);
    }
  }
}

if (hasError) {
  process.exit(1);
}
