import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

test('ships a complete HTML document', () => {
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<title>LumaPause/);
  assert.match(html, /<main/);
});

test('labels the interactive experience as simulated', () => {
  assert.match(html, /SIMULATED SIGNALS/);
  assert.match(html, /not SmartSpectra data/i);
});

test('includes consent and privacy language', () => {
  assert.match(html, /I understand this website uses simulated signals only/);
  assert.match(html, /No camera access/);
  assert.match(html, /not medical advice/i);
});

test('contains all interactive demo stages', () => {
  for (const stage of ['welcome', 'consent', 'calibration', 'room', 'reflection', 'cleared']) {
    assert.match(html, new RegExp(`data-screen="${stage}"`));
  }
});

test('includes reduced-motion and responsive support', () => {
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /@media\(max-width:700px\)/);
});
