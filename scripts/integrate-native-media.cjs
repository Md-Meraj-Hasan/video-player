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

console.log(`Native Media3 audio service/plugin and direct-URI video activity copied and registered in ${mainActivity}; media permissions and ExoPlayer/session/UI dependencies configured.`);
