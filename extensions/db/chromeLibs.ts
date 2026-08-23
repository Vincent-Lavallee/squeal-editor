import { dlopen, FFIType } from 'bun:ffi';

export function openKernel32() {
    return dlopen('kernel32.dll', {
        LoadLibraryW: { args: [FFIType.ptr], returns: FFIType.ptr },
        GetProcAddress: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    });
}

export function openUser32() {
    return dlopen('user32.dll', {
        FindWindowExW: {
            args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.ptr,
        },
        GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
        IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 },
        GetWindow: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
        IsZoomed: { args: [FFIType.ptr], returns: FFIType.i32 },
        GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        GetClientRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        ClientToScreen: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        MonitorFromWindow: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
        GetMonitorInfoW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        SetWindowPos: {
            args: [
                FFIType.ptr,
                FFIType.ptr,
                FFIType.i32,
                FFIType.i32,
                FFIType.i32,
                FFIType.i32,
                FFIType.u32,
            ],
            returns: FFIType.i32,
        },
        GetWindowLongW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
        RegisterWindowMessageW: { args: [FFIType.ptr], returns: FFIType.u32 },
        SetWindowsHookExW: {
            args: [FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u32],
            returns: FFIType.ptr,
        },
        UnhookWindowsHookEx: { args: [FFIType.ptr], returns: FFIType.i32 },
        SendMessageTimeoutW: {
            args: [
                FFIType.ptr,
                FFIType.u32,
                FFIType.ptr,
                FFIType.ptr,
                FFIType.u32,
                FFIType.u32,
                FFIType.ptr,
            ],
            returns: FFIType.ptr,
        },
        PostMessageW: {
            args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
            returns: FFIType.i32,
        },
    });
}

export function openDwmapi() {
    return dlopen('dwmapi.dll', {
        DwmSetWindowAttribute: {
            args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
            returns: FFIType.i32,
        },
    });
}
