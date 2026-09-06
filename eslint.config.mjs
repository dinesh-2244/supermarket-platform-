// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier';

/**
 * The modular-monolith modules (docs/phase-0-architecture.md §4).
 * `platform` is the shared kernel every other module may depend on — but, like all
 * of them, only through its public `index.ts`.
 */
const MODULES = [
  'platform',
  'stores',
  'catalog',
  'pricing',
  'inventory',
  'identity',
  'customers',
  'cart',
  'checkout',
  'orders',
  'fulfillment',
  'notifications',
  'admin',
];

/**
 * Module-boundary zones for `import/no-restricted-paths` (architecture §2):
 * a module's internals (`domain/`, `service.ts`, `repo.ts`) are private; every
 * consumer — another module, `app/`, or `components/` — must go through `index.ts`.
 */
const moduleZones = MODULES.map((mod) => ({
  target: [
    './src/app',
    './src/components',
    ...MODULES.filter((other) => other !== mod).map((other) => `./src/modules/${other}`),
  ],
  from: `./src/modules/${mod}`,
  except: ['./index.ts'],
  message: `Cross-boundary import: reach '${mod}' only through src/modules/${mod}/index.ts.`,
}));

const boundaryZones = [
  ...moduleZones,
  {
    // `lib/` is framework glue only — it must never reach into domain logic.
    target: './src/lib',
    from: './src/modules',
    message: 'src/lib is framework glue only; it must not import src/modules.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'src/generated/**',
      // Deliberate boundary violations used as lint fixtures; asserted on by
      // tests/unit/module-boundaries.test.ts, never linted as project source.
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
      },
    },
    plugins: {
      import: importPlugin,
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // Coding standards §17: `any` is an error, not a warning.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',

      // Module boundaries (§2).
      'import/no-restricted-paths': [
        'error',
        { basePath: import.meta.dirname, zones: boundaryZones },
      ],
      'import/no-cycle': ['error', { maxDepth: 6 }],
    },
  },
  {
    // Only `platform/db` may touch Prisma directly; everything else goes through it.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/modules/platform/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message:
                'Import the Prisma client from src/modules/platform (db) — never construct your own.',
            },
          ],
        },
      ],
    },
  },
  {
    // Config files, tests and the seed run outside the app's boundary rules.
    files: [
      '*.config.{ts,mts,mjs,js}',
      'prisma/**/*.ts',
      'tests/**/*.ts',
      'src/**/__tests__/**/*.ts',
    ],
    rules: {
      'import/no-restricted-paths': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettierConfig,
);
