// Compiles scripts/windows-window-chrome.c into the DLL the extension injects
// into the app process, and puts it beside the extension binary because that is
// where the extension looks for it (see extensions/db/chrome.ts).
//
// Silent no-op off Windows, and a warning rather than a failure when no C
// compiler is on the machine: the app runs without the DLL exactly as it did
// before there was one, so a dev box with no toolchain still builds and starts.
// `--required` turns that warning into a failure, which is what the release
// uses -- shipping an installer that quietly lost the window chrome is the one
// case where "best effort" is the wrong answer.

import { mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SOURCE = 'scripts/windows-window-chrome.c';
const OUTPUT = 'extensions/db/squeal-window-chrome.dll';

/**
 * Linked in a scratch directory and copied in, never built in place.
 *
 * Every Windows linker drops more than the DLL -- an import library, and a .pdb
 * unless it is talked out of one -- and `neu build` copies the whole extensions
 * folder into the bundle, which the installer then ships recursively. Building
 * beside the extension binary puts that litter in the release; building here
 * cannot, whatever the compiler decides to emit.
 */
const BUILD_DIR = join(tmpdir(), 'squeal-window-chrome-build');
const LINKED = join(BUILD_DIR, 'squeal-window-chrome.dll');

const required = process.argv.includes('--required');

if (process.platform !== 'win32') process.exit(0);

rmSync(BUILD_DIR, { recursive: true, force: true });
mkdirSync(BUILD_DIR, { recursive: true });

/**
 * `cl` with the static CRT: the DLL calls nothing from it, and linking the
 * dynamic one would make the app depend on a Visual C++ redistributable being
 * installed on the user's machine to get its titlebar right.
 */
function msvc(compiler: string) {
    return [
        compiler,
        '/nologo',
        '/O1',
        '/MT',
        '/LD',
        '/W3',
        SOURCE,
        `/Fo:${join(BUILD_DIR, 'squeal-window-chrome.obj')}`,
        `/Fe:${LINKED}`,
        '/link',
        'user32.lib',
        `/IMPLIB:${join(BUILD_DIR, 'squeal-window-chrome.lib')}`,
    ];
}

// `-g0` because clang and zig emit a .pdb otherwise: the scratch directory
// already keeps it out of the bundle, but debug info for sixty lines of window
// chrome is nothing anyone will read.
function unixLike(compiler: string[]) {
    return [...compiler, '-O2', '-g0', '-shared', '-o', LINKED, SOURCE, '-luser32'];
}

/**
 * A VS install with no `cl` on PATH is the normal state of a developer machine:
 * the compiler only exists inside a developer command prompt. vcvars64 is what
 * that prompt runs, so run it too and keep the same shell for the compile.
 */
function developerPrompt(): string[] | null {
    const vswhere = join(
        process.env['ProgramFiles(x86)'] ?? '',
        'Microsoft Visual Studio',
        'Installer',
        'vswhere.exe',
    );
    if (!Bun.file(vswhere).size) return null;

    const found = Bun.spawnSync([
        vswhere,
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath',
    ]);
    const installation = found.stdout.toString().trim();
    if (!installation) return null;

    const vcvars = join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
    if (!Bun.file(vcvars).size) return null;

    // Quoted per argument, not just around vcvars: the object and import-library
    // paths go through tmpdir, and a username with a space in it is enough to cut
    // the compile line in half.
    const compile = msvc('cl')
        .map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
        .join(' ');
    return ['cmd', '/c', `"${vcvars}" >nul && ${compile}`];
}

function toolchain(): string[] | null {
    if (Bun.which('cl')) return msvc('cl');

    const prompt = developerPrompt();
    if (prompt) return prompt;

    // clang and gcc both accept the MSVC-flavoured source unchanged; whichever is
    // present is fine, and zig ships a clang that needs no separate SDK at all.
    for (const compiler of [['clang'], ['gcc'], ['zig', 'cc']]) {
        if (Bun.which(compiler[0]!)) return unixLike(compiler);
    }
    return null;
}

const command = toolchain();

if (!command) {
    const message = `No C compiler found (cl, clang, gcc or zig), so ${OUTPUT} was not built.`;
    if (required) {
        console.error(`${message} The release must ship it.`);
        process.exit(1);
    }
    console.warn(
        `${message} The app will run without the window chrome: the titlebar keeps its 7px band and minimise/maximise do not animate.`,
    );
    process.exit(0);
}

const build = Bun.spawn(command, { stdout: 'inherit', stderr: 'inherit' });
const status = await build.exited;

if (status !== 0) {
    if (required) process.exit(status);
    console.warn(`Compiling ${OUTPUT} failed; the app will run without the window chrome.`);
    process.exit(0);
}

copyFileSync(LINKED, OUTPUT);
rmSync(BUILD_DIR, { recursive: true, force: true });
