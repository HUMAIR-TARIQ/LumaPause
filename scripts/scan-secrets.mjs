#!/usr/bin/env node
/**
 * Credential scan.
 *
 * Scans:
 *   1. every Git-tracked file,
 *   2. build output (out/, release/, dist/) when present,
 *   3. Git history (unless --no-history).
 *
 * It reports redacted locations only. Documented placeholders such as
 * `SMARTSPECTRA_API_KEY=YOUR_KEY` and the deliberate fake values used by the
 * redaction tests are allow-listed, so the check can fail a real leak rather
 * than a tutorial.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const includeHistory = !process.argv.includes('--no-history');
const verbose = process.argv.includes('--verbose');

const BUILD_DIRS = ['out', 'release', 'release-build', 'release-final', 'dist'];
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.icns',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.wav',
  '.ogg',
  '.mp4',
  '.webm',
  '.mov',
  '.zip',
  '.7z',
  '.gz',
  '.tar',
  '.bz2',
  '.xz',
  '.exe',
  '.msi',
  '.dll',
  '.node',
  '.so',
  '.dylib',
  '.pak',
  '.asar',
  '.pdf',
  '.db',
  '.sqlite',
]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const PLACEHOLDER =
  /^(?:YOUR(?:_API)?_KEY|YOUR[-_]KEY|YOUR[-_]API[-_]KEY|YOUR-KEY|<[^>]*>|\.{3}|…|changeme|change_me|example|placeholder|redacted|none|null|undefined)$/i;

/** Deliberate fake values in the test suite, used to prove redaction. */
const KNOWN_FAKE = new Set([
  'sk-test-secret-123456',
  'sk-test-unique-lumapause-key-987654',
  'sk-live-abcdef1234567890',
  'E2E_SECURITY_SENTINEL_KEY_987654321',
  'E2E_SENTINEL_KEY_NOT_A_REAL_SECRET_123456789',
]);

const TOKEN_PATTERNS = [
  { name: 'Presage/OpenAI-style key', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'Private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
];

const findings = [];
let filesScanned = 0;
let bytesScanned = 0;
let skippedBinary = 0;

function redact(value) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return `*** (length ${trimmed.length})`;
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-2)} (length ${trimmed.length})`;
}

function isPlaceholder(value) {
  const cleaned = value.trim().replace(/^["']|["']$/g, '');
  if (!cleaned) return true;
  if (PLACEHOLDER.test(cleaned)) return true;
  if (KNOWN_FAKE.has(cleaned)) return true;
  if (cleaned.startsWith('$') || cleaned.includes('process.env')) return true;
  if (/^\$\{?[A-Z0-9_]+\}?$/.test(cleaned)) return true;
  return false;
}

function isBinaryBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}

function skipFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function addFinding(source, location, kind, value) {
  findings.push({ source, location, kind, redacted: redact(value) });
}

function scanText(text, source, location) {
  const lines = text.split(/\r?\n/);
  const inTests = /(^|[\\/])tests[\\/]/.test(location);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    // Assignment forms. This catches a real key in .env, shell, or source.
    const envMatch = line.match(
      /(?:^|\s)(?:export\s+)?SMARTSPECTRA_API_KEY\s*[:=]\s*["']?([^"'#\s`]+)/,
    );
    if (envMatch && !isPlaceholder(envMatch[1])) {
      addFinding(
        source,
        `${location}:${lineNumber}`,
        'SMARTSPECTRA_API_KEY assignment',
        envMatch[1],
      );
    }

    const apiKeyMatch = line.match(/\bapiKey\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/);
    if (apiKeyMatch && !isPlaceholder(apiKeyMatch[1])) {
      addFinding(source, `${location}:${lineNumber}`, 'literal apiKey', apiKeyMatch[1]);
    }

    for (const { name, regex } of TOKEN_PATTERNS) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        const value = match[0];
        if (KNOWN_FAKE.has(value)) continue;
        if (inTests && /(?:test|fake|dummy|sentinel|not[_-]?a[_-]?real)/i.test(value)) {
          continue;
        }
        if (name === 'JWT' && /\.map$|package-lock\.json$/.test(location)) continue;
        addFinding(source, `${location}:${lineNumber}`, name, value);
      }
    }
  }
}

function scanBuffer(buffer, source, location) {
  if (buffer.length === 0) return;
  if (buffer.length > MAX_FILE_BYTES) {
    if (verbose) console.log(`skip large file: ${location}`);
    return;
  }
  if (isBinaryBuffer(buffer)) {
    skippedBinary += 1;
    return;
  }
  filesScanned += 1;
  bytesScanned += buffer.length;
  scanText(buffer.toString('utf8'), source, location);
}

function scanFile(filePath, source) {
  if (skipFile(filePath)) return;
  const relative = path.relative(root, filePath) || filePath;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return;
    scanBuffer(fs.readFileSync(filePath), source, relative);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`could not read ${relative}: ${error.message}`);
    }
  }
}

function walk(directory, source) {
  if (!fs.existsSync(directory)) return;
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, source);
    } else if (entry.isFile()) {
      scanFile(full, source);
    }
  }
}

function scanProjectFiles() {
  let output;
  try {
    // Tracked plus untracked files that are not ignored. This lets the scan fail
    // before a leak is ever staged.
    output = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`git ls-files failed: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const paths = output.split('\0').filter(Boolean);
  for (const relative of paths) {
    scanFile(path.join(root, relative), 'project');
  }
}

function scanHistory() {
  let diff;
  try {
    diff = execFileSync(
      'git',
      ['log', '--all', '-p', '--no-ext-diff', '--unified=0', '--pretty=format:__LUMA_COMMIT__%H'],
      { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
    );
  } catch (error) {
    console.error(`git log failed: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  let commit = 'unknown';
  let file = 'unknown';
  let lineNumber = 0;
  const lines = diff.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('__LUMA_COMMIT__')) {
      commit = line.slice('__LUMA_COMMIT__'.length) || 'unknown';
      continue;
    }
    if (line.startsWith('+++ b/')) {
      file = line.slice('+++ b/'.length);
      lineNumber = 0;
      continue;
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      lineNumber = match ? Math.max(0, Number(match[1]) - 1) : 0;
      continue;
    }
    if (line.startsWith('+') || line.startsWith('-')) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      lineNumber += 1;
      const content = line.slice(1);
      scanText(content, 'history', `${commit.slice(0, 10)}:${file}:${lineNumber}`);
      continue;
    }
    if (line.startsWith(' ')) lineNumber += 1;
  }
}

console.log('LumaPause credential scan');
scanProjectFiles();
for (const directory of BUILD_DIRS) walk(path.join(root, directory), 'build');
if (includeHistory) scanHistory();

if (findings.length === 0) {
  console.log(
    `PASS — ${filesScanned} text files scanned (${(bytesScanned / 1024).toFixed(1)} KiB), ` +
      `${skippedBinary} binary files skipped, history ${includeHistory ? 'included' : 'excluded'}.`,
  );
  process.exit(process.exitCode ?? 0);
}

console.error(`\nFAIL — ${findings.length} potential secret(s):`);
for (const finding of findings) {
  console.error(`  [${finding.kind}] ${finding.source} ${finding.location} → ${finding.redacted}`);
}
console.error(
  '\nRevoke any exposed credential, remove it from the working tree and history, then rerun.',
);
process.exit(1);
