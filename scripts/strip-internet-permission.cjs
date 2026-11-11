const fs = require("fs");
const path = require("path");
const manifest = path.join(process.cwd(), "android", "app", "src", "main", "AndroidManifest.xml");
if (!fs.existsSync(manifest)) throw new Error("AndroidManifest.xml not found: " + manifest);
let xml = fs.readFileSync(manifest, "utf8");
if (!xml.includes('android.permission.INTERNET')) {
  xml = xml.replace(/<manifest\b[^>]*>/, match => match + '\n    <uses-permission android:name="android.permission.INTERNET" />');
}
fs.writeFileSync(manifest, xml);
if (!xml.includes('android.permission.INTERNET')) throw new Error("Downloader INTERNET permission is missing.");
console.log("INTERNET permission enabled for Nice Downloader.");
