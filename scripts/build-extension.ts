// Compiles the extension into a self-contained binary, and on Windows names it
// after the app.
//
// Without the metadata the compiled binary reports itself as "Bun", carries the
// Bun logo, and shows up in Task Manager as a process with no visible relation
// to Squeal Editor. `bun build --compile` writes the resource itself, so this is
// the only place the extension needs; the Neutralino binary has no such flag and
// is handled by scripts/stamp-version-info.ts.

import { tmpdir } from "node:os";
import { join } from "node:path";

const COMPANY = "Vincent Lavallee";
const PRODUCT = "Squeal Editor";

const ICON_SOURCE = "frontend/public/icon.png";
const ICON_DIRECTORY_SIZE = 6;
const ICON_ENTRY_SIZE = 16;
// A width/height byte of 0 means 256 — the only size the source PNG has, and the
// size Windows downscales from for the 16px rows Task Manager draws.
const LARGEST_ICON = 0;

// Windows has read PNG-compressed icon entries since Vista, so the app's PNG can
// be wrapped as-is rather than re-encoded into a DIB.
async function icoWrapping(pngPath: string) {
  const png = await Bun.file(pngPath).bytes();
  const ico = new Uint8Array(ICON_DIRECTORY_SIZE + ICON_ENTRY_SIZE + png.length);
  const fields = new DataView(ico.buffer);

  fields.setUint16(2, 1, true); // resource type: icon
  fields.setUint16(4, 1, true); // one image
  ico[6] = LARGEST_ICON;
  ico[7] = LARGEST_ICON;
  fields.setUint16(10, 1, true); // colour planes
  fields.setUint16(12, 32, true); // bits per pixel
  fields.setUint32(14, png.length, true);
  fields.setUint32(18, ICON_DIRECTORY_SIZE + ICON_ENTRY_SIZE, true);
  ico.set(png, ICON_DIRECTORY_SIZE + ICON_ENTRY_SIZE);

  const icoPath = join(tmpdir(), "squeal-editor-extension.ico");
  await Bun.write(icoPath, ico);
  return icoPath;
}

async function windowsMetadata() {
  const { version } = await Bun.file("package.json").json();
  return [
    "--windows-title",
    PRODUCT,
    "--windows-description",
    PRODUCT,
    "--windows-publisher",
    COMPANY,
    "--windows-version",
    version,
    "--windows-icon",
    await icoWrapping(ICON_SOURCE),
  ];
}

const command = [
  process.execPath,
  "build",
  "extensions/db/main.ts",
  "--compile",
  "--outfile",
  "extensions/db/squeal-db-ext",
  ...(process.platform === "win32" ? await windowsMetadata() : []),
];

const build = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
process.exit(await build.exited);
