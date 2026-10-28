import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Two projects. Unit and integration tests run inside workerd, the same
// runtime as the deployed Worker; each test file gets a fresh local D1
// database with every migration in migrations/db applied
// (tests/unit/setup/apply-migrations.ts). Component tests mount Vue pages in
// a Nuxt environment (happy-dom) with mocked API endpoints. End-to-end browser
// tests live in tests/e2e (Playwright).
const dbMigrations = await readD1Migrations('migrations/db')

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: '2026-10-20',
              compatibilityFlags: ['nodejs_compat', 'no_nodejs_compat_v2'],
              d1Databases: ['DB'],
              bindings: { TEST_DB_MIGRATIONS: dbMigrations },
            },
          }),
        ],
        // Nuxt's alias for shared/, so app/ helpers can be tested as they are written.
        resolve: { alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/unit/setup/apply-migrations.ts'],
          // Vitest blanks CSS imports by default; the contrast test reads these two.
          css: { include: [/(tokens|components)\.css/] },
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['tests/nuxt/**/*.test.ts'],
          environment: 'nuxt',
          environmentOptions: { nuxt: { domEnvironment: 'happy-dom' } },
        },
      }),
    ],
  },
})
