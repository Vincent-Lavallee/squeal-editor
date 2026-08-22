// Rewrites the VS_VERSIONINFO resource of the packaged Windows binary, so Task
// Manager, the Details tab and the shortcut properties all name the process
// "Squeal Editor".
//
// It exists because `neu build` writes its own, describing every app it builds
// as "A Neutralinojs application" — the name Task Manager then shows above the
// app's other processes, where it reads as something unrelated. The extension
// binary does not go through here: `bun build --compile` writes its own
// metadata, see scripts/build-extension.ts.

import { dlopen, FFIType, ptr } from 'bun:ffi';

const COMPANY = 'Vincent Lavallee';
const PRODUCT = 'Squeal Editor';

const RT_VERSION = 16n;
const VERSION_RESOURCE_ID = 1n;
// `neu build` files its own version resource under the neutral language, and
// Windows reads whichever comes first — so anything written under en-US lands
// in the binary and is never looked at. Overwrite the neutral one instead.
const NEUTRAL_LANGUAGE = 0x0000;
const US_ENGLISH = 0x0409;
const UNICODE_CODEPAGE = 0x04b0;

const VS_FFI_SIGNATURE = 0xfeef04bd;
const VS_FFI_STRUCVERSION = 0x00010000;
// eslint-disable-next-line @typescript-eslint/naming-convention -- the literal Win32 API name.
const VOS__WINDOWS32 = 0x00000004;
const VFT_APP = 0x00000001;

const TEXT = 1;
const BINARY = 0;

const terminated = (text: string) => Buffer.from(`${text}\0`, 'utf16le');
const paddingAfter = (length: number) => Buffer.alloc((4 - (length % 4)) % 4);

// Every block is padded out to a 4-byte boundary and reports that padding in
// its own length, so walking a parent's children is just "advance by wLength".
function block(
    key: string,
    type: number,
    value: Buffer,
    valueLength: number,
    children: Buffer[] = [],
) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(valueLength, 2);
    header.writeUInt16LE(type, 4);

    const name = terminated(key);
    const body = Buffer.concat([
        header,
        name,
        paddingAfter(header.length + name.length),
        value,
        paddingAfter(value.length),
        ...children,
    ]);
    body.writeUInt16LE(body.length, 0);
    return body;
}

// wValueLength counts characters for text and bytes for binary — the one place
// the two block kinds disagree.
const textBlock = (key: string, value: string) =>
    block(key, TEXT, terminated(value), value.length + 1);

function fixedFileInfo(version: number[]) {
    const info = Buffer.alloc(52);
    const high = ((version[0] << 16) | version[1]) >>> 0;
    const low = ((version[2] << 16) | version[3]) >>> 0;

    info.writeUInt32LE(VS_FFI_SIGNATURE, 0);
    info.writeUInt32LE(VS_FFI_STRUCVERSION, 4);
    info.writeUInt32LE(high, 8);
    info.writeUInt32LE(low, 12);
    info.writeUInt32LE(high, 16);
    info.writeUInt32LE(low, 20);
    info.writeUInt32LE(0x3f, 24);
    info.writeUInt32LE(0, 28);
    info.writeUInt32LE(VOS__WINDOWS32, 32);
    info.writeUInt32LE(VFT_APP, 36);
    return info;
}

function versionResource(version: string, fileName: string) {
    const parts = version.split('.').map(Number);
    const [major = 0, minor = 0, patch = 0] = parts;
    const build = 0;

    const translation = Buffer.alloc(4);
    translation.writeUInt16LE(US_ENGLISH, 0);
    translation.writeUInt16LE(UNICODE_CODEPAGE, 2);

    const strings = block(
        `${US_ENGLISH.toString(16).padStart(4, '0')}${UNICODE_CODEPAGE.toString(16).padStart(4, '0')}`,
        TEXT,
        Buffer.alloc(0),
        0,
        [
            textBlock('CompanyName', COMPANY),
            textBlock('FileDescription', PRODUCT),
            textBlock('FileVersion', `${major}.${minor}.${patch}.${build}`),
            textBlock('InternalName', PRODUCT),
            textBlock('LegalCopyright', `Copyright © ${COMPANY}`),
            textBlock('OriginalFilename', fileName),
            textBlock('ProductName', PRODUCT),
            textBlock('ProductVersion', version),
        ],
    );

    return block('VS_VERSION_INFO', BINARY, fixedFileInfo([major, minor, patch, build]), 52, [
        block('StringFileInfo', TEXT, Buffer.alloc(0), 0, [strings]),
        block('VarFileInfo', TEXT, Buffer.alloc(0), 0, [
            block('Translation', BINARY, translation, translation.length),
        ]),
    ]);
}

const kernel32 = dlopen('kernel32.dll', {
    BeginUpdateResourceW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.u64 },
    UpdateResourceW: {
        args: [FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u16, FFIType.ptr, FFIType.u32],
        returns: FFIType.i32,
    },
    EndUpdateResourceW: { args: [FFIType.u64, FFIType.i32], returns: FFIType.i32 },
});

export function stampVersionInfo(exePath: string, version: string) {
    const resource = versionResource(version, exePath.split(/[\\/]/).pop()!);
    const path = terminated(exePath);

    const update = kernel32.symbols.BeginUpdateResourceW(ptr(path), 0);
    if (update === 0n) throw new Error(`Cannot open ${exePath} for resource update`);

    const written = kernel32.symbols.UpdateResourceW(
        update,
        RT_VERSION,
        VERSION_RESOURCE_ID,
        NEUTRAL_LANGUAGE,
        ptr(resource),
        resource.length,
    );
    if (!written) {
        kernel32.symbols.EndUpdateResourceW(update, 1);
        throw new Error(`Cannot write the version resource into ${exePath}`);
    }

    if (!kernel32.symbols.EndUpdateResourceW(update, 0)) {
        throw new Error(`Cannot commit the version resource into ${exePath}`);
    }
}

if (import.meta.main) {
    if (process.platform !== 'win32') {
        console.log('Not Windows — nothing to stamp.');
        process.exit(0);
    }

    const { version } = await Bun.file('package.json').json();
    const exePath = process.argv[2] ?? 'dist/squeal-editor/squeal-editor-win_x64.exe';

    stampVersionInfo(exePath, version);
    console.log(`Stamped ${PRODUCT} ${version} into ${exePath}`);
}
