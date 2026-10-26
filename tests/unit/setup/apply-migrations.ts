import { applyD1Migrations, env } from 'cloudflare:test'

// Applying migrations is idempotent, so running this before every test file
// is safe and means a broken migration fails CI.
await applyD1Migrations(env.DB, env.TEST_DB_MIGRATIONS)
await applyD1Migrations(env.SAFEGUARDING_DB, env.TEST_SAFEGUARDING_MIGRATIONS)
