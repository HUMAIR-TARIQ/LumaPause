/**
 * Generate packaging icons from the 1024px master artwork.
 *
 * Run with Electron, because `nativeImage` is an Electron module:
 *   env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron.exe scripts/make-icons.mjs
 *
 * Outputs:
 *   build/icon.png      512px source icon (Linux/asar metadata)
 *   build/icon.ico      multi-frame PNG-compressed Windows icon (16-256px)
 */
import { nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'vibe_images', 'lumapause-icon_1794217667407_f8128039.png');
const OUT_DIR = path.join(root, 'build');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Build a PNG-compressed ICO container (Vista+ supports embedded PNG frames). */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const entries = Buffer.alloc(16 * frames.length);
  let offset = header.length + entries.length;

  frames.forEach(({ size, data }, index) => {
    const entry = 16 * index;
    entries.writeUInt8(size >= 256 ? 0 : size, entry);
    entries.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    entries.writeUInt8(0, entry + 2); // palette size
    entries.writeUInt8(0, entry + 3); // reserved
    entries.writeUInt16LE(1, entry + 4); // colour planes
    entries.writeUInt16LE(32, entry + 6); // bits per pixel
    entries.writeUInt32LE(data.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, entries, ...frames.map((frame) => frame.data)]);
}

function resize(source, size) {
  const image = source.resize({ width: size, height: size, quality: 'best' });
  if (image.isEmpty()) throw new Error(`nativeImage produced an empty ${size}px frame`);
  const data = image.toPNG();
  if (data.length === 0) throw new Error(`PNG encoding failed for ${size}px`);
  return { size, data };
}

try {
  if (!fs.existsSync(SOURCE)) throw new Error(`Missing master artwork: ${SOURCE}`);

  const master = nativeImage.createFromPath(SOURCE);
  if (master.isEmpty()) throw new Error(`Could not decode master artwork: ${SOURCE}`);
  const sourceSize = master.getSize();
  if (sourceSize.width < 256 || sourceSize.height < 256) {
    throw new Error(
      `Master artwork must be at least 256px, got ${sourceSize.width}x${sourceSize.height}`,
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const png = resize(master, 512);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png.data);

  const frames = ICO_SIZES.map((size) => resize(master, size));
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(frames));

  console.log(`Source: ${path.relative(root, SOURCE)} (${sourceSize.width}x${sourceSize.height})`);
  console.log(`Wrote build/icon.png (512x512, ${png.data.length} bytes)`);
  console.log(
    `Wrote build/icon.ico (${ICO_SIZES.join(', ')} px, ${frames.reduce((n, f) => n + f.data.length, 0)} bytes of frames)`,
  );
} finally {
  // nativeImage is usable before the ready event, so leave immediately rather
  // than waiting on the GUI lifecycle.
  process.exit(0);
}
