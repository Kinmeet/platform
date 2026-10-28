// Checks the build output for code we must never ship (Security Reviewer,
// #141). @nuxtjs/robots depends on @fingerprintjs/botd, a browser
// fingerprinting library, which is installed but must never be bundled: with
// `robots.botDetection` off, nothing from it is. A module upgrade that
// changed the default, or the option being turned on, would serve it from
// our own origin, where the no-third-party test can't see it. So this fails
// if:
// - `robots.botDetection` isn't `false` in the resolved Nuxt config;
// - any file under .output/public or .output/server names botd or
//   fingerprintjs. (`botDetection`, the option's own name, is not a match.)
//
// Run after any build:
//   bun run build && bun run check:build-output
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadNuxtConfig } from 'nuxt/kit'

const OUTPUT_DIRS = ['.output/public', '.output/server']
const FORBIDDEN = /\bbotd\b|fingerprintjs/i

const problems: string[] = []

const config = await loadNuxtConfig({ cwd: process.cwd() })
const robots = (config as { robots?: { botDetection?: unknown } }).robots
if (robots?.botDetection !== false) {
  problems.push('nuxt.config.ts: robots.botDetection must be false')
}

for (const dir of OUTPUT_DIRS) {
  let files: string[]
  try {
    files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  } catch {
    problems.push(`${dir} is missing: run \`bun run build\` first`)
    continue
  }
  for (const file of files) {
    const path = join(dir, file)
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue // a directory
    }
    const match = FORBIDDEN.exec(text)
    if (match) problems.push(`${path} contains "${match[0]}"`)
  }
}

if (problems.length > 0) {
  console.error(`Build output check failed:\n${problems.map((p) => `- ${p}`).join('\n')}`)
  process.exit(1)
}
console.log('Build output check passed: no bot detection or fingerprinting code.')
