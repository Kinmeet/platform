import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

  modules: ['@nuxtjs/i18n', '@nuxt/eslint'],

  css: ['~/assets/css/main.css'],

  features: {
    // Keep component CSS in files so the policy can stay style-src 'self'.
    inlineStyles: false,
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
    cloudflare: {
      // wrangler.jsonc is kept by hand so environments and bindings are reviewed.
      deployConfig: false,
      nodeCompat: true,
    },
  },

  hooks: {
    'nitro:build:public-assets': async (nitro) => {
      await writeFile(join(nitro.options.output.publicDir, '_headers'), staticAssetHeaders())
    },
  },

  eslint: {
    config: {
      stylistic: false,
    },
  },
})
