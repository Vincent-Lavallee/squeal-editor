import { useCallback, useState } from 'react';

/** A message per tab, or `null` for none -- the save bar's error and notice both. */
export function usePerTabMessage() {
    const [messages, setMessages] = useState<Record<string, string | null>>({});

    const set = useCallback((tabId: string, message: string | null) => {
        setMessages((prev) => (prev[tabId] === message ? prev : { ...prev, [tabId]: message }));
    }, []);

    const clear = useCallback((tabId: string) => {
        setMessages((prev) => (prev[tabId] == null ? prev : { ...prev, [tabId]: null }));
    }, []);

    const prune = useCallback((live: Set<string>) => {
        setMessages((prev) => {
            const kept = Object.entries(prev).filter(([id]) => live.has(id));
            return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
        });
    }, []);

    return { messages, set, clear, prune };
}
