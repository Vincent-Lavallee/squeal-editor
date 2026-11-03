export const NO_NATIVE_SUGGESTIONS = {
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    spellCheck: false,
    // Lowercase and a string on purpose: React 18 has no prop for it, so it
    // only reaches the DOM as an unknown attribute passed through verbatim.
    writingsuggestions: 'false',
} as const;
