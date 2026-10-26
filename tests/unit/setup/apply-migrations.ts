import { applyD1Migrations, env } from 'cloudflare:test'

// Applying migrations is idempotent, so running this before every test file
// is safe and means a broken migration fails CI.
await applyD1Migrations(env.DB, env.TEST_DB_MIGRATIONS)
