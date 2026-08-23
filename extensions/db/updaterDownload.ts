import type { ReadableStreamDefaultReader } from 'node:stream/web';

import type { UpdateProgress } from '../../shared/protocol/index.ts';

// GitHub's API refuses requests with no User-Agent; the value itself is free.
export const USER_AGENT = 'squeal-editor-updater';

export async function downloadWithProgress(
    url: string,
    onProgress: (p: UpdateProgress) => void,
): Promise<Buffer> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !res.body) throw new Error(`The update download failed (HTTP ${res.status}).`);

    // 0 when the CDN sent no length; the UI shows an indeterminate bar then.
    const totalBytes = Number(res.headers.get('content-length')) || 0;
    // `ReadableStream` isn't a resolvable global type without the DOM lib, which
    // this tsconfig deliberately excludes -- so without this annotation
    // `res.body.getReader()` silently degrades to `any`. Bun's fetch implements
    // the same WHATWG stream interface Node's `stream/web` types describe.
    const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;
        onProgress({ receivedBytes, totalBytes });
    }

    return Buffer.concat(chunks);
}

export async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`The update download failed (HTTP ${res.status}).`);
    return res.text();
}
