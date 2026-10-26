import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Unit and integration tests run inside workerd, the same runtime as the
// deployed Worker. End-to-end browser tests live in tests/e2e (Playwright).
// Each test file gets a fresh local D1 database with every migration in
// migrations/db applied (tests/unit/setup/apply-migrations.ts).
const dbMigrations = await readD1Migrations('migrations/db')

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-10-20',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        bindings: { TEST_DB_MIGRATIONS: dbMigrations },
      },
    }),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup/apply-migrations.ts'],
    // Vitest blanks CSS imports by default; the contrast test reads tokens.css.
    css: { include: [/tokens\.css/] },
  },
})
