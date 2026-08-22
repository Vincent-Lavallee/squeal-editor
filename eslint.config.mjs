import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// Interfaces, types, classes and enums are PascalCase; enum members are
// SCREAMING_SNAKE_CASE; everything else defaults to camelCase. Object/type
// properties are left unchecked because they frequently mirror external
// shapes (database columns, wire payloads) this codebase doesn't own.
const namingConvention = [
    {
        selector: 'default',
        format: ['camelCase'],
        leadingUnderscore: 'allow',
        trailingUnderscore: 'forbid',
    },
    { selector: 'import', format: ['camelCase', 'PascalCase'] },
    {
        selector: 'variable',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        leadingUnderscore: 'allow',
    },
    { selector: 'function', format: ['camelCase', 'PascalCase'] },
    // PascalCase too: a destructured component -- `({ Glyph }) => <Glyph />` -- has to
    // stay capitalized, or JSX reads it as an intrinsic element instead of a component.
    { selector: 'parameter', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
    { selector: 'parameter', modifiers: ['unused'], format: null },
    { selector: 'typeLike', format: ['PascalCase'] },
    { selector: 'enumMember', format: ['UPPER_CASE'] },
    { selector: ['objectLiteralProperty', 'typeProperty', 'classProperty'], format: null },
    // The Handlers object's keys are wire command names ('db.saved.list', 'ai.cancel',
    // ...), not JS identifiers -- see shared/protocol/. Not this codebase's to rename.
    { selector: 'objectLiteralMethod', format: null },
];

const sizeLimits = {
    'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': [
        'error',
        { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true },
    ],
};

// docs/README.md's "Conventions" section: both barrels exist so a type/helper
// can move between domain files without touching its callers. Importing past
// the barrel is the exact thing that guarantee depends on nobody doing.
const barrelOnlyImports = {
    patterns: [
        {
            group: ['**/protocol/*', '!**/protocol/index.ts'],
            message: 'Import from shared/protocol/index.ts, not a domain file directly.',
        },
        {
            group: ['**/drivers/*', '!**/drivers/index.ts'],
            message: 'Import from drivers/index.ts, not an engine file directly.',
        },
    ],
};

const es6Rules = {
    'no-var': 'error',
    'prefer-const': 'error',
    'prefer-arrow-callback': 'error',
    'object-shorthand': 'error',
    'prefer-template': 'error',
    'prefer-spread': 'error',
    'prefer-rest-params': 'error',
    'no-useless-constructor': 'error',
    // 'smart' rather than 'always': the codebase's `x == null` idiom (both null
    // and undefined at once) is deliberate, not a coercion bug.
    eqeqeq: ['error', 'smart'],
    'no-console': 'error',
};

const typeCheckedExtras = {
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
};

export default tseslint.config(
    {
        ignores: [
            '.claude/**',
            '**/node_modules/**',
            'resources/**',
            'bin/**',
            'frontend/public/js/**',
            '.tmp/**',
            'dist/**',
            'installer/**',
            'extensions/db/squeal-db-ext*',
            'extensions/db/squeal-window-chrome.dll',
            'tests/fixtures/shop.db',
            '**/*.bun-build',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        rules: {
            ...es6Rules,
            ...sizeLimits,
            '@typescript-eslint/naming-convention': ['error', ...namingConvention],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            'no-restricted-imports': ['error', barrelOnlyImports],
            complexity: ['warn', 15],
            'max-depth': ['warn', 4],
            'max-params': ['warn', 4],
        },
    },
    // Frontend: type-checked against frontend/tsconfig.json, React-aware, browser globals.
    {
        files: ['frontend/src/**/*.{ts,tsx}'],
        extends: [...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                project: './frontend/tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
            globals: globals.browser,
        },
        plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
        rules: {
            ...react.configs.flat.recommended.rules,
            ...react.configs.flat['jsx-runtime'].rules,
            ...reactHooks.configs['recommended-latest'].rules,
            ...reactRefresh.configs.vite.rules,
            ...typeCheckedExtras,
            // React-Compiler-readiness checks, opinionated enough to flag several
            // patterns this codebase uses on purpose (an effect that resets state on a
            // prop change, an always-latest ref to dodge a stale closure, and this
            // rule's own second-guessing of when a dependency really changed).
            'react-hooks/exhaustive-deps': 'off',
            'react-hooks/set-state-in-effect': 'off',
            'react-hooks/refs': 'off',
            'react-hooks/static-components': 'off',
        },
        // 'detect' calls into eslint-plugin-react's version-sniffing codepath, which
        // isn't compatible with ESLint 10's context API yet — pin it instead.
        settings: { react: { version: '18.3.1' } },
    },
    // Extension: type-checked against extensions/db/tsconfig.json, Node globals.
    {
        files: ['extensions/db/**/*.ts'],
        extends: [...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                project: './extensions/db/tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
            globals: globals.node,
        },
        rules: { ...typeCheckedExtras },
    },
    // shared/, scripts/, tests/: real source, but not covered by either tsconfig's
    // program root, so no type-aware rules here — same boundary `bun run typecheck` uses.
    {
        files: ['shared/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
        languageOptions: { globals: globals.node },
        rules: {
            // Build/release scripts and test fixtures print to stdout on purpose;
            // only app code (which has its own logger) is expected to stay quiet.
            'no-console': 'off',
        },
    },
    prettierConfig,
);
