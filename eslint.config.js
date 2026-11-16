import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import boundaries from 'eslint-plugin-boundaries'

const el = (types) => ({ to: { element: { types } } })

// Only src/adapters may talk to the network or to Supabase directly (AD-1).
const restrictedImports = [
  'error',
  {
    // Covers @supabase/supabase-js and every other @supabase/* subpackage.
    patterns: [
      {
        group: ['@supabase/*'],
        message: 'Import Supabase only inside src/adapters. Go through a port or repository.',
      },
    ],
  },
]
const fetchMessage = 'Use fetch only inside src/adapters. Go through a port or repository.'
const restrictedProperties = [
  'error',
  ...['window', 'globalThis', 'self'].map((object) => ({
    object,
    property: 'fetch',
    message: fetchMessage,
  })),
]
const restrictedGlobals = [
  'error',
  {
    name: 'fetch',
    message: fetchMessage,
  },
]

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
      'node_modules',
      '_bmad',
      '_bmad-output',
      '.claude',
      'docs',
      'supabase',
      'src/adapters/supabase/database.types.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      boundaries,
    },
    settings: {
      // Resolve the "@/*" -> "src/*" alias (tsconfig paths) so boundaries can classify imports.
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app', partialMatch: false },
        { type: 'features', pattern: 'src/features', partialMatch: false },
        { type: 'ui', pattern: 'src/ui', partialMatch: false },
        { type: 'data', pattern: 'src/data', partialMatch: false },
        { type: 'domain', pattern: 'src/domain', partialMatch: false },
        { type: 'ports', pattern: 'src/ports', partialMatch: false },
        { type: 'adapters', pattern: 'src/adapters', partialMatch: false },
      ],
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-restricted-imports': restrictedImports,
      'no-restricted-globals': restrictedGlobals,
      'no-restricted-properties': restrictedProperties,
      // Layer map (Story 1.1 AC, default disallow). Dependencies point inward; ui stays dumb;
      // only the composition root in src/app may reach adapters and ports to wire them up.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: el(['app', 'features', 'ui', 'data', 'domain']),
            },
            {
              from: { element: { type: 'app', fileInternalPath: 'composition.ts' } },
              allow: el(['adapters', 'ports']),
            },
            {
              from: { element: { type: 'features' } },
              allow: el(['features', 'domain', 'data', 'ui']),
            },
            { from: { element: { type: 'ui' } }, allow: el(['ui']) },
            { from: { element: { type: 'data' } }, allow: el(['data', 'domain', 'ports']) },
            { from: { element: { type: 'adapters' } }, allow: el(['adapters', 'ports', 'domain']) },
            { from: { element: { type: 'ports' } }, allow: el(['ports', 'domain']) },
            { from: { element: { type: 'domain' } }, allow: el(['domain']) },
          ],
        },
      ],
    },
  },
  {
    files: ['src/adapters/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    // Tests may reach across layers to set up fixtures and mocks. The import/global bans still apply.
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'boundaries/dependencies': 'off' },
  },
  {
    files: ['src/sw.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
)
