const fs = require("fs");
const path = require("path");
const manifest = path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml");
if (!fs.existsSync(manifest)) {
  console.error("AndroidManifest.xml not found:", manifest);
  process.exit(1);
}
let xml = fs.readFileSync(manifest, "utf8");
// Remove any direct INTERNET permission line. We intentionally ship no networking permission.
xml = xml.replace(/^\s*<uses-permission\b[^>]*android:name=["']android\.permission\.INTERNET["'][^>]*\/>\s*\r?\n?/gm, "");
// Add an explicit manifest-merger removal marker so library manifests cannot re-add INTERNET.
if (!xml.includes('tools:node="remove"') || !xml.includes('android.permission.INTERNET')) {
  xml = xml.replace(/<manifest\b([^>]*)>/, (match, attrs) => {
    let nextAttrs = attrs;
    if (!/xmlns:tools=/.test(nextAttrs)) nextAttrs += ' xmlns:tools="http://schemas.android.com/tools"';
    return `<manifest${nextAttrs}>`;
  });
  xml = xml.replace(/(<manifest\b[^>]*>)/, '$1\n    <uses-permission android:name="android.permission.INTERNET" tools:node="remove" />');
}
fs.writeFileSync(manifest, xml);
if (!xml.includes('android.permission.INTERNET" tools:node="remove"')) {
  console.error("Could not enforce removal of INTERNET permission.");
  process.exit(1);
}
console.log("Network permission blocked: INTERNET is removed via Android manifest merger.");
