import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT_DIR, 'www');

const FRONTEND_FILES = ['index.html'];
const FRONTEND_DIRS = ['css', 'js', 'assets'];

const FORBIDDEN_FILES = [
  '.env',
  '.env.local',
  '.env.example',
  'api',
  'supabase',
  'ocr_server.py',
  'ocr_pipeline.py',
  'ocr-requirements.txt'
];

const SECRET_PATTERNS = [
  /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"`]?[A-Za-z0-9._-]{20,}/i,
  /sb_secret_[A-Za-z0-9_-]{10,}/i,
  /postgresql:\/\/[^:\s]+:[^@\s]+@/i
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry.startsWith('.env') || entry === '.gitkeep') continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function normalizeUrlEnv(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed;
}

function injectPublicRuntimeUrls() {
  const configPath = path.join(WWW_DIR, 'js', 'app-config.js');
  if (!fs.existsSync(configPath)) return;

  const vercelUrl = normalizeUrlEnv(
    process.env.VERCEL_API_URL ||
    process.env.SCANSHEET_VERCEL_URL ||
    process.env.VERCEL_URL ||
    ''
  );
  const ocrUrl = normalizeUrlEnv(process.env.OCR_API_URL || '');

  let content = fs.readFileSync(configPath, 'utf8');

  if (vercelUrl) {
    content = content.replace(
      /VERCEL_API_BASE_URL:\s*['"][^'"]*['"]/,
      `VERCEL_API_BASE_URL: ${JSON.stringify(vercelUrl)}`
    );
    console.log(`[build-web] Configured VERCEL_API_BASE_URL in www/js/app-config.js -> ${vercelUrl}`);
  }

  if (ocrUrl) {
    content = content.replace(
      /OCR_API_URL:\s*['"][^'"]*['"]/,
      `OCR_API_URL: ${JSON.stringify(ocrUrl)}`
    );
    console.log(`[build-web] Configured OCR_API_URL in www/js/app-config.js -> ${ocrUrl}`);
  }

  fs.writeFileSync(configPath, content, 'utf8');
}

function verifyNoSecretsBundled(dir) {
  for (const forbidden of FORBIDDEN_FILES) {
    const target = path.join(dir, forbidden);
    if (fs.existsSync(target)) {
      throw new Error(`Forbidden backend/secret path found in www/: ${forbidden}`);
    }
  }

  const walk = (current) => {
    for (const entry of fs.readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (/\.(html|js|css|json|txt)$/i.test(entry)) {
        const text = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(text)) {
            throw new Error(`Potential secret value detected in bundled web asset: ${path.relative(WWW_DIR, fullPath)}`);
          }
        }
      }
    }
  };

  walk(dir);
}

function main() {
  fs.rmSync(WWW_DIR, { recursive: true, force: true });
  fs.mkdirSync(WWW_DIR, { recursive: true });

  for (const file of FRONTEND_FILES) {
    const src = path.join(ROOT_DIR, file);
    if (!fs.existsSync(src)) {
      throw new Error(`Required frontend file missing: ${file}`);
    }
    copyRecursive(src, path.join(WWW_DIR, file));
  }

  for (const dir of FRONTEND_DIRS) {
    const src = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(src)) {
      throw new Error(`Required frontend directory missing: ${dir}`);
    }
    copyRecursive(src, path.join(WWW_DIR, dir));
  }

  injectPublicRuntimeUrls();
  verifyNoSecretsBundled(WWW_DIR);

  console.log('[build-web] Successfully prepared clean web assets in www/');
}

main();

