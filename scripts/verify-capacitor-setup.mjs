import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function testCapacitorConfig() {
  const capConfig = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'capacitor.config.json'), 'utf8'));
  assert.equal(capConfig.appId, 'com.scansheet.app', 'appId must be com.scansheet.app');
  assert.equal(capConfig.appName, 'ScanSheet', 'appName must be ScanSheet');
  assert.equal(capConfig.webDir, 'www', 'webDir must be www');
  assert.ok(!capConfig.server?.url, 'Must NOT replace app with a remote server.url wrapper');
  console.log('PASS: capacitor.config.json validated');
}

function testWebAssetsAndSecrets() {
  const wwwDir = path.join(ROOT_DIR, 'www');
  const androidPublicDir = path.join(ROOT_DIR, 'android', 'app', 'src', 'main', 'assets', 'public');

  for (const baseDir of [wwwDir, androidPublicDir]) {
    assert.ok(fs.existsSync(baseDir), `Missing bundled assets directory: ${baseDir}`);
    for (const rel of [
      'index.html',
      'css/style.css',
      'js/app.js',
      'js/app-config.js',
      'js/supabase-client.js',
      'js/scanner.js',
      'js/export.js',
      'assets/icons/logo.svg'
    ]) {
      assert.ok(fs.existsSync(path.join(baseDir, rel)), `Missing ${rel} in ${baseDir}`);
    }

    for (const forbidden of ['.env', '.env.local', 'api', 'supabase', 'ocr_server.py', 'ocr_pipeline.py', 'android', 'node_modules']) {
      assert.ok(!fs.existsSync(path.join(baseDir, forbidden)), `Forbidden path ${forbidden} found in ${baseDir}`);
    }
  }
  console.log('PASS: www/ and android assets verified free of backend/env files');
}

function testAndroidPlatformFiles() {
  const requiredFiles = [
    'android/build.gradle',
    'android/app/build.gradle',
    'android/app/src/main/AndroidManifest.xml',
    'android/app/src/main/res/values/strings.xml',
    'android/app/src/main/java/com/scansheet/app/MainActivity.java',
    'android/gradlew',
    'android/gradlew.bat',
    'android/gradle/wrapper/gradle-wrapper.jar',
    'android/gradle/wrapper/gradle-wrapper.properties'
  ];

  for (const rel of requiredFiles) {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, rel)), `Missing Android file: ${rel}`);
  }

  const appGradle = fs.readFileSync(path.join(ROOT_DIR, 'android/app/build.gradle'), 'utf8');
  assert.ok(appGradle.includes('applicationId "com.scansheet.app"'), 'applicationId mismatch in app/build.gradle');

  const stringsXml = fs.readFileSync(path.join(ROOT_DIR, 'android/app/src/main/res/values/strings.xml'), 'utf8');
  assert.ok(stringsXml.includes('<string name="app_name">ScanSheet</string>'), 'app_name mismatch in strings.xml');

  const workflow = fs.readFileSync(path.join(ROOT_DIR, '.github/workflows/android-debug-apk.yml'), 'utf8');
  assert.ok(workflow.includes('./gradlew assembleDebug'), 'GitHub Actions must run ./gradlew assembleDebug');
  assert.ok(workflow.includes('app-debug.apk'), 'GitHub Actions must upload app-debug.apk');

  console.log('PASS: Android platform, Gradle wrapper, and GitHub Actions workflow validated');
}

async function testAppConfigResolver() {
  const { AppConfig } = await import(pathToFileURL(path.join(ROOT_DIR, 'js/app-config.js')).href);

  // 1. Web / Vercel mode (no Capacitor)
  globalThis.window = {
    location: { protocol: 'https:', origin: 'https://scansheet.example.vercel.app', pathname: '/' }
  };
  assert.equal(AppConfig.isCapacitorNative(), false);
  assert.equal(AppConfig.resolveApiUrl('/api/config'), '/api/config');
  assert.equal(AppConfig.resolveApiUrl('/api/scan'), '/api/scan');

  // 2. Capacitor Android native mode with unconfigured placeholder
  globalThis.window = {
    Capacitor: { isNativePlatform: () => true },
    location: { protocol: 'https:', origin: 'https://localhost', pathname: '/index.html' }
  };
  assert.equal(AppConfig.isCapacitorNative(), true);
  assert.equal(AppConfig.resolveApiUrl('/api/config'), null);

  // 3. Capacitor Android native mode with deployed Vercel URL configured
  globalThis.window.__ENV__ = { VERCEL_API_BASE_URL: 'https://scansheet-prod.vercel.app/' };
  assert.equal(AppConfig.resolveApiUrl('/api/config'), 'https://scansheet-prod.vercel.app/api/config');
  assert.equal(AppConfig.resolveApiUrl('/api/scan'), 'https://scansheet-prod.vercel.app/api/scan');
  assert.equal(AppConfig.getPasswordResetRedirectUrl(), 'https://scansheet-prod.vercel.app/');

  delete globalThis.window;
  console.log('PASS: AppConfig web vs Capacitor Android URL resolution verified');
}

async function testBackendCors() {
  const { default: handler } = await import(pathToFileURL(path.join(ROOT_DIR, 'api/config.js')).href);

  const runHandler = (method, origin) => {
    const headers = {};
    let statusCode = 0;
    let body = null;
    const req = { method, headers: origin ? { origin } : {} };
    const res = {
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      status(code) {
        statusCode = code;
        return {
          json(data) { body = data; return res; },
          end() { return res; }
        };
      }
    };
    handler(req, res);
    return { statusCode, headers, body };
  };

  for (const origin of ['https://localhost', 'http://localhost', 'capacitor://localhost']) {
    const preflight = runHandler('OPTIONS', origin);
    assert.equal(preflight.statusCode, 200);
    assert.equal(preflight.headers['access-control-allow-origin'], origin);
    assert.ok(preflight.headers['access-control-allow-methods'].includes('GET'));
    assert.ok(preflight.headers['access-control-allow-methods'].includes('OPTIONS'));

    const getRes = runHandler('GET', origin);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.headers['access-control-allow-origin'], origin);
    assert.deepEqual(Object.keys(getRes.body).sort(), ['ocrServerUrl', 'supabaseAnonKey', 'supabaseUrl']);
  }

  console.log('PASS: api/config.js CORS & public response verified for Capacitor origins');
}

function testJsSyntax() {
  const filesToCheck = [
    'api/config.js',
    'js/app-config.js',
    'js/supabase-client.js',
    'js/scanner.js',
    'js/export.js',
    'js/auth.js',
    'js/app.js',
    'scripts/build-web.mjs',
    'scripts/verify-capacitor-setup.mjs'
  ];

  for (const rel of filesToCheck) {
    execFileSync(process.execPath, ['--check', path.join(ROOT_DIR, rel)], { stdio: 'pipe' });
  }
  console.log(`PASS: Syntax verified for ${filesToCheck.length} JavaScript files`);
}

async function main() {
  await testCapacitorConfig();
  testWebAssetsAndSecrets();
  testAndroidPlatformFiles();
  await testAppConfigResolver();
  await testBackendCors();
  testJsSyntax();
  console.log('ALL VERIFICATIONS PASSED');
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});

