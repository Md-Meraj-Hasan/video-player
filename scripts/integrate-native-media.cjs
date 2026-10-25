const fs = require('fs');
const path = require('path');

const root = process.cwd();
const androidRoot = path.join(root, 'android');
const appRoot = path.join(androidRoot, 'app');
const javaRoot = path.join(appRoot, 'src', 'main', 'java');
const manifest = path.join(appRoot, 'src', 'main', 'AndroidManifest.xml');
const nativeRoot = path.join(root, 'android-native');

function walk(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(full, entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(androidRoot)) throw new Error('Android project not found. Run npx cap add android first.');
if (!fs.existsSync(manifest)) throw new Error(`AndroidManifest.xml not found at ${manifest}`);

// Capacitor templates may generate MainActivity.kt or MainActivity.java and the
// source package may not match capacitor.config.json's appId. Find the actual activity.
let activities = walk(javaRoot, (file, name) => /^MainActivity\.(kt|java)$/.test(name));
let mainActivity = activities[0];
let packageName;

if (mainActivity) {
  const content = fs.readFileSync(mainActivity, 'utf8');
  const match = content.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;?/m);
  if (!match) throw new Error(`Could not determine package declaration in ${mainActivity}`);
  packageName = match[1];
} else {
  // Some generated projects have no activity source yet. Derive package from Gradle,
  // falling back to Capacitor appId, then create a Kotlin BridgeActivity.
  const gradleFiles = [path.join(appRoot, 'build.gradle'), path.join(appRoot, 'build.gradle.kts')];
  let gradleText = gradleFiles.filter(fs.existsSync).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const ns = gradleText.match(/namespace\s*(?:=\s*)?["']([^"']+)["']/);
  const appId = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8')).appId;
  packageName = (ns && ns[1]) || appId || 'com.meraj.mediaplayer';
  const dir = path.join(javaRoot, ...packageName.split('.'));
  fs.mkdirSync(dir, { recursive: true });
  mainActivity = path.join(dir, 'MainActivity.kt');
  fs.writeFileSync(mainActivity, `package ${packageName}\n\nimport android.os.Bundle\nimport com.getcapacitor.BridgeActivity\n\nclass MainActivity : BridgeActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        registerPlugin(MediaPermissionPlugin::class.java)\n        registerPlugin(MediaLibraryScannerPlugin::class.java)\n        registerPlugin(MerajMediaPlayerPlugin::class.java)\n        super.onCreate(savedInstanceState)\n    }\n}\n`);
}

const activityDir = path.dirname(mainActivity);
for (const name of ['MediaPermissionPlugin.kt', 'MediaLibraryScannerPlugin.kt', 'MerajMediaPlayerPlugin.kt', 'MerajPlaybackService.kt', 'NativeVideoPlayerActivity.kt']) {
  const source = path.join(nativeRoot, name);
  if (!fs.existsSync(source)) throw new Error(`Required native plugin source missing: ${source}`);
  let code = fs.readFileSync(source, 'utf8');
  code = code.replace(/^\s*package\s+[A-Za-z0-9_.]+\s*$/m, `package ${packageName}`);
  fs.writeFileSync(path.join(activityDir, name), code);
}

// Register plugins in the actual generated MainActivity, whether Kotlin or Java.
let main = fs.readFileSync(mainActivity, 'utf8');
if (!main.includes('MediaPermissionPlugin::class.java') && !main.includes('MediaPermissionPlugin.class')) {
  if (mainActivity.endsWith('.kt')) {
    const onCreate = /override\s+fun\s+onCreate\s*\(\s*savedInstanceState\s*:\s*Bundle\?\s*\)\s*\{/.exec(main);
    if (onCreate) {
      const insertAt = onCreate.index + onCreate[0].length;
      main = main.slice(0, insertAt) + '\n        registerPlugin(MediaPermissionPlugin::class.java)\n        registerPlugin(MediaLibraryScannerPlugin::class.java)\n        registerPlugin(MerajMediaPlayerPlugin::class.java)' + main.slice(insertAt);
    } else {
      main = main.replace(/class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{?\s*\}?\s*$/, `class MainActivity : BridgeActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        registerPlugin(MediaPermissionPlugin::class.java)\n        registerPlugin(MediaLibraryScannerPlugin::class.java)\n        registerPlugin(MerajMediaPlayerPlugin::class.java)\n        super.onCreate(savedInstanceState)\n    }\n}`);
    }
  } else {
    // Capacitor's default Java MainActivity is often an empty class with no
    // onCreate override. Add one when absent; otherwise inject registrations.
    const onCreate = /(?:@Override\s*)?protected\s+void\s+onCreate\s*\(\s*Bundle\s+savedInstanceState\s*\)\s*\{/.exec(main);
    if (onCreate) {
      const insertAt = onCreate.index + onCreate[0].length;
      main = main.slice(0, insertAt) + '\n        registerPlugin(MediaPermissionPlugin.class);\n        registerPlugin(MediaLibraryScannerPlugin.class);\n        registerPlugin(MerajMediaPlayerPlugin.class);' + main.slice(insertAt);
    } else {
      if (!/import\s+android\.os\.Bundle\s*;/.test(main)) {
        const packageMatch = /package\s+[A-Za-z0-9_.]+\s*;/.exec(main);
        if (packageMatch) {
          const at = packageMatch.index + packageMatch[0].length;
          main = main.slice(0, at) + '\n\nimport android.os.Bundle;' + main.slice(at);
        } else {
          throw new Error(`Could not find package declaration in ${mainActivity}`);
        }
      }
      const classOpen = /class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/.exec(main);
      if (!classOpen) throw new Error(`Could not find MainActivity extends BridgeActivity class in ${mainActivity}`);
      const insertAt = classOpen.index + classOpen[0].length;
      main = main.slice(0, insertAt) + `\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        registerPlugin(MediaPermissionPlugin.class);\n        registerPlugin(MediaLibraryScannerPlugin.class);\n        registerPlugin(MerajMediaPlayerPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n` + main.slice(insertAt);
    }
  }
}
if (!main.includes('MediaLibraryScannerPlugin::class.java') && !main.includes('MediaLibraryScannerPlugin.class')) {
  throw new Error(`Could not register native media scanner in ${mainActivity}`);
}
if (!main.includes('MerajMediaPlayerPlugin::class.java') && !main.includes('MerajMediaPlayerPlugin.class')) {
  main = main.replace(/registerPlugin\(MediaLibraryScannerPlugin(::class\.java|\.class)\);?/, match => match + (match.includes('::class') ? '\n        registerPlugin(MerajMediaPlayerPlugin::class.java)' : '\n        registerPlugin(MerajMediaPlayerPlugin.class);'));
}
fs.writeFileSync(mainActivity, main);

let xml = fs.readFileSync(manifest, 'utf8');
const permissions = [
  '<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />',
  '<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />'
];
const missing = permissions.filter(p => !xml.includes(p));
if (missing.length) xml = xml.replace(/<manifest\b[^>]*>/, m => `${m}\n    ${missing.join('\n    ')}`);
fs.writeFileSync(manifest, xml);

// The native media plugins are Kotlin source files. Capacitor's generated
// template can use a Java MainActivity and may not apply the Kotlin Android
// plugin by default, so enable Kotlin in both the root and app Gradle files.
function ensureKotlinGradlePlugin() {
  const appGradle = path.join(appRoot, 'build.gradle');
  if (!fs.existsSync(appGradle)) {
    throw new Error('Expected Groovy Gradle file android/app/build.gradle was not generated.');
  }

  let appText = fs.readFileSync(appGradle, 'utf8');
  if (!appText.includes("org.jetbrains.kotlin.android")) {
    // Put the versioned Kotlin plugin directly in the app plugins block.
    // Do not add a root-level plugins block: some Capacitor templates use a
    // buildscript block, and Gradle requires buildscript to precede plugins.
    if (/plugins\s*\{/.test(appText)) {
      appText = appText.replace(/plugins\s*\{/, match => `${match}\n    id 'org.jetbrains.kotlin.android' version '2.1.0'`);
    } else {
      // Fallback for older Groovy templates that use apply-plugin syntax.
      appText = `plugins { id 'org.jetbrains.kotlin.android' version '2.1.0' }\n${appText}`;
    }
    fs.writeFileSync(appGradle, appText);
  }
}

ensureKotlinGradlePlugin();

const appGradle = path.join(appRoot, 'build.gradle');
let gradleText = fs.readFileSync(appGradle, 'utf8');
if (!gradleText.includes('androidx.media3:media3-exoplayer')) {
  if (!/dependencies\s*\{/.test(gradleText)) throw new Error('Could not find dependencies block in android/app/build.gradle');
  gradleText = gradleText.replace(/dependencies\s*\{/, match => `${match}\n    implementation 'androidx.media3:media3-exoplayer:1.5.1'\n    implementation 'androidx.media3:media3-session:1.5.1'`);
  fs.writeFileSync(appGradle, gradleText);
} else if (!gradleText.includes('androidx.media3:media3-session')) {
  gradleText = gradleText.replace(/dependencies\s*\{/, match => `${match}\n    implementation 'androidx.media3:media3-session:1.5.1'`);
  fs.writeFileSync(appGradle, gradleText);
}


if (!gradleText.includes('androidx.media3:media3-ui')) {
  gradleText = gradleText.replace(/dependencies\s*\{/, match => `${match}\n    implementation 'androidx.media3:media3-ui:1.5.1'`);
  fs.writeFileSync(appGradle, gradleText);
}

// Register the MediaSessionService and foreground playback permissions.
xml = fs.readFileSync(manifest, 'utf8');
const servicePermissions = [
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />'
];
for (const permission of servicePermissions) {
  if (!xml.includes(permission)) xml = xml.replace(/<manifest\b[^>]*>/, match => `${match}\n    ${permission}`);
}
if (!xml.includes('NativeVideoPlayerActivity')) {
  xml = xml.replace(/<application\b[^>]*>/, match => `${match}\n        <activity android:name=".NativeVideoPlayerActivity" android:exported="false" android:screenOrientation="unspecified" android:configChanges="orientation|screenSize|keyboardHidden" />`);
}
if (!xml.includes('MerajPlaybackService')) {
  xml = xml.replace(/<application\b[^>]*>/, match => `${match}\n        <service android:name=".MerajPlaybackService" android:foregroundServiceType="mediaPlayback" android:exported="true">\n            <intent-filter>\n                <action android:name="androidx.media3.session.MediaSessionService" />\n            </intent-filter>\n        </service>`);
}
fs.writeFileSync(manifest, xml);


// Nice Multimedia branding: stable app label, upgraded APK version, and custom launcher icon.
const appName = 'Nice Multimedia';
const valuesDir = path.join(appRoot, 'src', 'main', 'res', 'values');
fs.mkdirSync(valuesDir, { recursive: true });
const stringsFile = path.join(valuesDir, 'strings.xml');
let stringsXml = fs.existsSync(stringsFile) ? fs.readFileSync(stringsFile, 'utf8') : '<?xml version="1.0" encoding="utf-8"?><resources></resources>';
if (/<string\s+name="app_name"[^>]*>.*?<\/string>/s.test(stringsXml)) {
  stringsXml = stringsXml.replace(/<string\s+name="app_name"[^>]*>.*?<\/string>/s, `<string name="app_name">${appName}</string>`);
} else {
  stringsXml = stringsXml.replace('</resources>', `    <string name="app_name">${appName}</string>\n</resources>`);
}
fs.writeFileSync(stringsFile, stringsXml);

// Set APK versionCode/versionName so Android recognizes this as an upgrade.
let versionGradle = fs.readFileSync(appGradle, 'utf8');
if (/versionCode\s+\d+/.test(versionGradle)) versionGradle = versionGradle.replace(/versionCode\s+\d+/, 'versionCode 2');
else if (/versionCode\s*=\s*\d+/.test(versionGradle)) versionGradle = versionGradle.replace(/versionCode\s*=\s*\d+/, 'versionCode = 2');
if (/versionName\s+["'][^"']+["']/.test(versionGradle)) versionGradle = versionGradle.replace(/versionName\s+["'][^"']+["']/, 'versionName "1.1.0"');
else if (/versionName\s*=\s*["'][^"']+["']/.test(versionGradle)) versionGradle = versionGradle.replace(/versionName\s*=\s*["'][^"']+["']/, 'versionName = "1.1.0"');
fs.writeFileSync(appGradle, versionGradle);

// Copy custom Nice Multimedia launcher icon at all standard Android densities.
const brandingRoot = path.join(root, 'android-branding');
const resRoot = path.join(appRoot, 'src', 'main', 'res');
for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  const target = path.join(resRoot, `mipmap-${density}`);
  fs.mkdirSync(target, { recursive: true });
  const icon = path.join(brandingRoot, density, 'ic_launcher.png');
  if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(target, 'ic_launcher.png'));
}
const baseMipmap = path.join(resRoot, 'mipmap');
fs.mkdirSync(baseMipmap, { recursive: true });
if (fs.existsSync(path.join(brandingRoot, 'ic_launcher.png'))) {
  fs.copyFileSync(path.join(brandingRoot, 'ic_launcher.png'), path.join(baseMipmap, 'ic_launcher.png'));
}
const adaptiveDir = path.join(resRoot, 'mipmap-anydpi-v26');
fs.mkdirSync(adaptiveDir, { recursive: true });
fs.writeFileSync(path.join(adaptiveDir, 'ic_launcher.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/nice_multimedia_icon_background" />\n    <foreground android:drawable="@drawable/nice_multimedia_icon_foreground" />\n</adaptive-icon>\n`);
const drawableDir = path.join(resRoot, 'drawable');
fs.mkdirSync(drawableDir, { recursive: true });
const foreground = path.join(brandingRoot, 'ic_launcher_foreground.png');
if (fs.existsSync(foreground)) fs.copyFileSync(foreground, path.join(drawableDir, 'nice_multimedia_icon_foreground.png'));
const colorsFile = path.join(valuesDir, 'colors.xml');
let colorsXml = fs.existsSync(colorsFile) ? fs.readFileSync(colorsFile, 'utf8') : '<?xml version="1.0" encoding="utf-8"?><resources></resources>';
if (!/<color\s+name="nice_multimedia_icon_background"/.test(colorsXml)) colorsXml = colorsXml.replace('</resources>', '    <color name="nice_multimedia_icon_background">#111326</color>\n</resources>');
fs.writeFileSync(colorsFile, colorsXml);
xml = fs.readFileSync(manifest, 'utf8');
xml = xml.replace(/android:label="[^"]*"/, 'android:label="@string/app_name"');
if (!/android:icon="[^"]*"/.test(xml)) xml = xml.replace(/<application\b/, '<application android:icon="@mipmap/ic_launcher"');
else xml = xml.replace(/android:icon="[^"]*"/, 'android:icon="@mipmap/ic_launcher"');
xml = xml.replace(/android:roundIcon="[^"]*"/, 'android:roundIcon="@mipmap/ic_launcher"');
fs.writeFileSync(manifest, xml);

console.log(`Nice Multimedia v1.1.0 branding applied; Media3 audio service/plugin and direct-URI video activity copied and registered in ${mainActivity}.`);
