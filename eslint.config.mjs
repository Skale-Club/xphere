// @ts-check
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

/**
 * ESLint flat config (ESLint 9 / Next.js 16).
 *
 * Next 16 removed the `next lint` command, so linting now runs through the
 * ESLint CLI (`eslint .`). eslint-config-next@16 ships *native* flat-config
 * arrays for its presets, so we compose them directly instead of going through
 * `@eslint/eslintrc` `FlatCompat` (which is only needed for legacy configs).
 *
 *   next/core-web-vitals -> eslint-config-next/core-web-vitals
 *   next/typescript      -> eslint-config-next/typescript
 *
 * @type {import('eslint').Linter.Config[]}
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Global ignores. ESLint already skips node_modules and .git by default;
    // the rest mirror .gitignore's generated output, plus the source dirs that
    // tsconfig "exclude" keeps out of the TypeScript program.
    ignores: [
      // Dependencies
      'node_modules/**',
      // Build output (generated)
      '.next/**',
      '.vercel/**',
      'out/**',
      'build/**',
      'coverage/**',
      // Generated browser bundles + PWA service worker (esbuild / serwist)
      'public/widget.js',
      'public/reviews-widget.js',
      'public/sw.js',
      'public/workbox-*.js',
      'public/serwist-*.js',
      // Non-source dirs (also excluded from tsconfig)
      'supabase/functions/**',
      'scripts/**',
    ],
  },
]

export default eslintConfig
