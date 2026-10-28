import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deployEnvironmentProblem } from './shared/deploy-env'
import { buildSecurityHeaders } from './server/utils/security-headers'

// Static files are served by Workers static assets without running the
// Worker, so they get their headers from a generated `_headers` file built
// from the same policy as the Worker's middleware.
function staticAssetHeaders(): string {
  const headers = buildSecurityHeaders({ path: '/' })
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)
  // Nitro appends its own cache rules for /_nuxt/* after this block.
  return ['/*', ...lines, ''].join('\n')
}

export default defineNuxtConfig({
  compatibilityDate: '2026-10-20',
  devtools: { enabled: false },
  telemetry: false,

  modules: ['@nuxtjs/i18n', '@nuxt/eslint', '@nuxthub/core'],

  // NuxtHub for hub:db only (ADR-0009). Wrangler is the only tool that
  // applies migrations, everywhere: `bun run db:migrate:local` in development,
  // scripts/d1-migrate.sh on deploy. hub:kv, hub:blob and hub:cache stay off.
  hub: {
    db: {
      dialect: 'sqlite',
      // The local D1 that Wrangler migrates, never libSQL.
      driver: 'd1',
      migrationsDirs: [fileURLToPath(new URL('./migrations/db', import.meta.url))],
      applyMigrationsDuringDev: false,
      applyMigrationsDuringBuild: false,
    },
  },

  css: ['~/assets/css/main.css'],

  features: {
    // Keep component CSS in files so the policy can stay style-src 'self'.
    inlineStyles: false,
  },

  runtimeConfig: {
    public: {
      // Set per environment by NUXT_PUBLIC_TURNSTILE_SITE_KEY in wrangler.jsonc
      // (#20). Empty means the spam check can't load and forms say so.
      turnstileSiteKey: '',
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  i18n: {
    defaultLocale: 'en-GB',
    strategy: 'no_prefix',
    // Never set a language cookie or redirect on the browser's language.
    detectBrowserLanguage: false,
    locales: [{ code: 'en-GB', language: 'en-GB', name: 'English', file: 'en-GB.json' }],
  },

  nitro: {
    preset: 'cloudflare_module',
    // Scheduled jobs (ADR-0002: server/tasks/). Each cron here must also be
    // listed under `triggers.crons` in wrangler.jsonc, which is kept by hand.
    experimental: { tasks: true },
    scheduledTasks: {
      // Daily at 03:17 UTC: delete personal data past its deletion date (P3, #31).
      '17 3 * * *': ['retention:delete-expired'],
    },
    cloudflare: {
      // NuxtHub turns deployConfig on: the build writes .output/server/wrangler.json
      // from the hand-kept wrangler.jsonc, flattening the CLOUDFLARE_ENV
      // environment into it (ADR-0009). Bindings are still written only in
      // wrangler.jsonc; scripts/check-generated-config.ts checks the result.
      nodeCompat: true,
    },
  },

  // The deployed entry refuses oversized bodies before Nitro (ADR-0008).
  // Production only: a custom entry breaks `nuxt dev`.
  $production: {
    nitro: {
      entry: fileURLToPath(new URL('./worker/entry.ts', import.meta.url)),
    },
  },

  hooks: {
    // Without CLOUDFLARE_ENV, Workers Builds would ship the local config, and
    // `--env` can't save it, so the build stops first (ADR-0009).
    'build:before': () => {
      const problem = deployEnvironmentProblem(process.env)
      if (problem) throw new Error(problem)
    },
    'nitro:build:public-assets': async (nitro) => {
      const publicDir = nitro.options.output.publicDir
      // Pages must be rendered by the Worker so they get a nonce and, on form
      // pages, Turnstile. A prerendered page would be served as a static file
      // with neither, so the build fails instead.
      const files = await readdir(publicDir, { recursive: true })
      const pages = files.filter((file) => file.endsWith('.html'))
      if (pages.length > 0) {
        throw new Error(`Prerendered pages are not allowed: ${pages.join(', ')}`)
      }
      // OFL condition 2: the font licences ship with the fonts (ADR-0007).
      const licences = ['fonts/Fredoka-OFL.txt', 'fonts/AtkinsonHyperlegibleNext-OFL.txt']
      const missing = licences.filter((licence) => !files.includes(licence))
      if (missing.length > 0) {
        throw new Error(`Font licences missing from the build: ${missing.join(', ')}`)
      }
      await writeFile(join(publicDir, '_headers'), staticAssetHeaders())
    },
  },

  eslint: {
    config: {
      stylistic: false,
    },
  },
})
