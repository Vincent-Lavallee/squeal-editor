import { existsSync } from 'node:fs';
import { rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { dataDir } from './store.ts';

/** What `neu build` names the Windows binary, and what the installer lays down. */
const APP_EXECUTABLE_WIN = 'squeal-editor-win_x64.exe';

/**
 * Walk up from a path inside the install (here, this extension's own compiled
 * binary) to the app's executable. Not a fixed count of `..`s, for the same
 * reason `findAppBundle` is not: the extension sits two levels under the
 * install root today (`extensions\db\`), and a layout change there should point
 * the relaunch at nothing rather than at the wrong thing -- so this throws, and
 * it throws before anything has been spawned or the app has been asked to exit.
 */
function findAppExecutable(startPath: string): string {
    let dir = dirname(startPath);
    while (dir !== dirname(dir)) {
        const candidate = join(dir, APP_EXECUTABLE_WIN);
        if (existsSync(candidate)) return candidate;
        dir = dirname(dir);
    }
    throw new Error(`Could not find ${APP_EXECUTABLE_WIN} above ${startPath}.`);
}

/** One tick is roughly a second: `ping -n 2` is how a redirected batch sleeps. */
const WINDOWS_WAIT_TICKS = 30;
const HANDOFF_CONFIRM_MS = 5_000;
const HANDOFF_POLL_MS = 100;

/**
 * The batch script that performs the Windows swap -- and, since it runs after
 * the app is gone, the only thing that can report on it.
 *
 * Every path it works on arrives in the environment rather than baked into the
 * text, because cmd reads a `.cmd` file in the console's OEM codepage: a data
 * directory under an accented user name, written here as UTF-8, would come back
 * as mojibake and the swap would run against a path that does not exist.
 * Environment values are handed over by the spawn itself and never go through
 * that decode, so keeping this file pure ASCII is what makes it correct on a
 * machine that is not this one.
 *
 * Exported for the unit tests, which is also why the tick count is a parameter.
 */
export function buildWindowsApplyScript(waitTicks: number = WINDOWS_WAIT_TICKS): string {
    return [
        '@echo off',
        'setlocal',
        // The extension's working directory is inside the install the installer is
        // about to replace, and a live working directory is a lock on it.
        'cd /d "%SystemRoot%"',
        'for %%p in ("%SQUEAL_UPDATE_LOG%") do if not exist "%%~dpp" mkdir "%%~dpp"',
        'call :apply > "%SQUEAL_UPDATE_LOG%" 2>&1',
        'exit /b',
        '',
        ':apply',
        'for %%p in ("%SQUEAL_UPDATE_APP%") do set "APP_DIR=%%~dpp"',
        'for %%p in ("%SQUEAL_UPDATE_APP%") do set "APP_IMAGE=%%~nxp"',
        'if "%APP_DIR:~-1%"=="\\" set "APP_DIR=%APP_DIR:~0,-1%"',
        // This first line is also the handshake: `applyUpdateWindows` waits for the
        // log to appear before it lets the app exit, so a script that never ran
        // reads as a failed apply rather than as a restart into the same version.
        'echo [%date% %time%] applying the update',
        'echo installer "%SQUEAL_UPDATE_INSTALLER%"',
        'echo app       "%SQUEAL_UPDATE_APP%"',
        'echo [%date% %time%] waiting for %APP_IMAGE% (%SQUEAL_UPDATE_APP_PID%) and %SQUEAL_UPDATE_EXT_IMAGE% (%SQUEAL_UPDATE_EXT_PID%) to exit',
        `for /l %%t in (1,1,${waitTicks}) do (`,
        '  call :running "%SQUEAL_UPDATE_APP_PID%" "%APP_IMAGE%" || call :running "%SQUEAL_UPDATE_EXT_PID%" "%SQUEAL_UPDATE_EXT_IMAGE%" || goto :closed',
        '  ping -n 2 127.0.0.1 >nul',
        ')',
        // Unlike the macOS swap, running out of patience here is survivable: the
        // installer closes what is still holding a file through Restart Manager,
        // which is a swap performed properly, not one performed underneath a live
        // app. So the wait is a courtesy and the deadline is not an abort.
        'echo [%date% %time%] they are still up; leaving them for the installer to close',
        ':closed',
        'echo [%date% %time%] running the installer',
        // Inno is told to restart nothing. It only brings back what it closed
        // itself, and the app has almost always exited on its own by now -- which
        // is exactly why trusting it left the user staring at nothing. The relaunch
        // below is unconditional instead, so there is one path back and it is this
        // script's.
        '"%SQUEAL_UPDATE_INSTALLER%" /SILENT /CLOSEAPPLICATIONS /NORESTARTAPPLICATIONS',
        'set "CODE=%ERRORLEVEL%"',
        'echo [%date% %time%] the installer exited with %CODE%',
        'if not "%CODE%"=="0" echo it did not finish, so what is on disk is whatever it replaced before it stopped',
        // Relaunched even after a failed install: the installer closes the app
        // before it can fail, and leaving the user with nothing running is worse
        // than leaving them on the version they already had.
        'echo [%date% %time%] relaunching "%SQUEAL_UPDATE_APP%"',
        'start "" /d "%APP_DIR%" "%SQUEAL_UPDATE_APP%"',
        'echo [%date% %time%] done',
        'exit /b',
        '',
        // CSV, because tasklist's table format truncates an image name at the
        // column width and the app's is longer than that. Matching the name as well
        // as the PID is what keeps a recycled PID from reading as still running,
        // and matching the echoed name rather than the "no tasks" notice is what
        // keeps this working on a Windows that is not in English.
        ':running',
        'tasklist /fi "PID eq %~1" /fi "IMAGENAME eq %~2" /nh /fo csv 2>nul | find /i "%~2" >nul',
        'exit /b %ERRORLEVEL%',
        '',
    ].join('\r\n');
}

/** Resolve once the script has written anything at all; throw if it never does. */
async function waitForHandoff(logPath: string): Promise<void> {
    const deadline = Date.now() + HANDOFF_CONFIRM_MS;
    for (;;) {
        const written = await stat(logPath).catch(() => null);
        if (written && written.size > 0) return;
        if (Date.now() >= deadline) {
            throw new Error(
                'The update could not be started -- nothing confirmed the installer was running, ' +
                    'so nothing was changed. See update.log in the app data folder.',
            );
        }
        await Bun.sleep(HANDOFF_POLL_MS);
    }
}

/**
 * Windows cannot overwrite its own running `.exe`, so the swap goes to a script
 * that outlives the app: it waits for the app and this extension to exit, runs
 * the installer, and launches the app again.
 *
 * Both ends of that handoff used to be blind, and each end lost an update in
 * its own way. The installer was spawned and the app exited in the same breath,
 * so a `cmd` that had not yet reached the installer died with the process that
 * spawned it -- nothing was updated and nothing had been asked to notice. And
 * `/RESTARTAPPLICATIONS` had nothing to bring back, because Restart Manager
 * restarts only what it closed itself and the app had already closed itself.
 * So, in the same order:
 *
 * - **The script is orphaned before the app goes away.** `start` gives it a
 *   parent that exits immediately, which is what leaves it running on its own
 *   instead of as a child this extension takes down with it.
 * - **This call does not resolve until the script has proven it is running**,
 *   by writing the first line of its log. The app exits on that resolution, so
 *   an apply that never got off the ground surfaces as an error the user can
 *   read rather than as a restart that changed nothing.
 * - **The relaunch is the script's, not the installer's** -- the same
 *   conclusion `applyUpdateDarwin` reached, arrived at from the other side.
 * - **The whole run is traced to `update.log` in `dataDir()`**, the directory
 *   the About menu's "Open app data" already opens, because the process that
 *   would report a failure is the one being replaced. It is deleted first, so
 *   what is there afterwards always describes the attempt just made and never
 *   an older one that happened to leave a file behind.
 */
export async function applyUpdateWindows(installerPath: string): Promise<void> {
    const appExecutable = findAppExecutable(process.execPath);
    const logPath = join(dataDir(), 'update.log');
    const scriptPath = join(dirname(installerPath), 'apply-update.cmd');

    await writeFile(scriptPath, buildWindowsApplyScript());
    await rm(logPath, { force: true });

    Bun.spawn(['cmd', '/c', 'start', '', '/b', 'cmd', '/c', scriptPath], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        windowsHide: true,
        env: {
            ...process.env,
            SQUEAL_UPDATE_INSTALLER: installerPath,
            SQUEAL_UPDATE_APP: appExecutable,
            SQUEAL_UPDATE_LOG: logPath,
            // Neutralino spawns extensions as its own children, so `ppid` is the app.
            SQUEAL_UPDATE_APP_PID: String(process.ppid),
            SQUEAL_UPDATE_EXT_PID: String(process.pid),
            SQUEAL_UPDATE_EXT_IMAGE: basename(process.execPath),
        },
    });

    await waitForHandoff(logPath);
}
