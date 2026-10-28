// Checks the Wrangler config that the build generates (ADR-0009, condition 1
// on #114). NuxtHub turns on Nitro's deployConfig, so a build writes
// .output/server/wrangler.json from wrangler.jsonc, flattening the
// CLOUDFLARE_ENV environment into its top level, and every Wrangler command
// after it deploys that file. A test of wrangler.jsonc alone would miss a
// binding that the flattening adds, drops or reshapes, so this reads the
// generated file itself.
//
// It fails if:
// - the bindings (names, ids, jurisdiction), the Worker name, compatibility
//   flags, crons, required secrets, logging (observability, logpush),
//   exposure (workers_dev, preview_urls) or vars names differ from the
//   committed snapshot, at the top level or in `previews`;
// - the config has a key that isn't on the known lists below, so a new kind
//   of binding (services, queues, ai and so on) can't arrive unreviewed;
// - anything in the `previews` block names a live database, namespace or
//   bucket.
//
// Run after a live build:
//   CLOUDFLARE_ENV=live bun run build && bun run check:generated-config
// After a reviewed binding change, refresh the snapshot with `--update` and
// commit it in the same PR.
import { readFileSync, writeFileSync } from 'node:fs'

const generatedPath = '.output/server/wrangler.json'
const snapshotPath = 'scripts/generated-config.live.json'

// Every key the generated config may have. Adding one is a reviewed change
// to this file (Security Reviewer, #137).
const KNOWN_KEYS = new Set([
  '$schema',
  'account_id',
  'assets',
  'compatibility_date',
  'compatibility_flags',
  'd1_databases',
  'kv_namespaces',
  'logpush',
  'main',
  'name',
  'observability',
  'preview_urls',
  'previews',
  'r2_buckets',
  'ratelimits',
  'secrets',
  'triggers',
  'vars',
  'workers_dev',
])
const KNOWN_PREVIEW_KEYS = new Set([
  'd1_databases',
  'kv_namespaces',
  'logpush',
  'observability',
  'r2_buckets',
  'ratelimits',
  'vars',
])

interface D1 {
  binding: string
  database_name: string
  database_id: string
  migrations_table?: string
}

interface Level {
  name?: string
  main?: string
  workers_dev?: boolean
  preview_urls?: boolean
  observability?: unknown
  logpush?: boolean
  vars?: Record<string, string>
  compatibility_flags?: string[]
  triggers?: { crons?: string[] }
  secrets?: { required?: string[] }
  d1_databases?: D1[]
  kv_namespaces?: { binding: string; id: string }[]
  r2_buckets?: { binding: string; bucket_name: string; jurisdiction?: string }[]
  ratelimits?: { name: string; namespace_id: string }[]
  previews?: Level
}

function bindings(level: Level) {
  return {
    // Logging settings (P5): a dropped `invocation_logs: false` would start
    // storing request details.
    observability: level.observability ?? null,
    logpush: level.logpush ?? null,
    var_names: Object.keys(level.vars ?? {}).sort(),
    d1: (level.d1_databases ?? []).map((d) => ({
      binding: d.binding,
      database_name: d.database_name,
      database_id: d.database_id,
      migrations_table: d.migrations_table ?? null,
    })),
    kv: (level.kv_namespaces ?? []).map((k) => ({ binding: k.binding, id: k.id })),
    r2: (level.r2_buckets ?? []).map((r) => ({
      binding: r.binding,
      bucket_name: r.bucket_name,
      jurisdiction: r.jurisdiction ?? null,
    })),
    ratelimits: (level.ratelimits ?? []).map((r) => ({
      name: r.name,
      namespace_id: r.namespace_id,
    })),
  }
}

function summary(config: Level) {
  return {
    name: config.name ?? null,
    // Nitro's output, which is our body-limit entry (ADR-0008); the
    // end-to-end body-limits test checks the entry itself.
    main: config.main ?? null,
    workers_dev: config.workers_dev ?? null,
    preview_urls: config.preview_urls ?? null,
    compatibility_flags: config.compatibility_flags ?? [],
    crons: config.triggers?.crons ?? [],
    required_secrets: config.secrets?.required ?? [],
    bindings: bindings(config),
    previews: config.previews ? bindings(config.previews) : null,
  }
}

const generated = JSON.parse(readFileSync(generatedPath, 'utf8')) as Level
const actual = summary(generated)
const problems: string[] = []

for (const key of Object.keys(generated)) {
  if (!KNOWN_KEYS.has(key)) problems.push(`unknown key in the generated config: ${key}`)
}
for (const key of Object.keys(generated.previews ?? {})) {
  if (!KNOWN_PREVIEW_KEYS.has(key)) problems.push(`unknown key in previews: ${key}`)
}

// Previews hold made-up data only: nothing in them may name a live resource.
const liveResources = [
  ...(generated.d1_databases ?? []).flatMap((d) => [d.database_name, d.database_id]),
  ...(generated.kv_namespaces ?? []).map((k) => k.id),
  ...(generated.r2_buckets ?? []).map((r) => r.bucket_name),
]
const previewsText = JSON.stringify(generated.previews ?? {})
for (const resource of liveResources) {
  if (previewsText.includes(resource)) problems.push(`previews names a live resource: ${resource}`)
}
if (/kinmeet-live/.test(previewsText)) problems.push('previews names a kinmeet-live resource')

const text = `${JSON.stringify(actual, null, 2)}\n`
if (process.argv.includes('--update')) {
  writeFileSync(snapshotPath, text)
  console.log(`Updated ${snapshotPath}. Run \`bun run format\`, then review the diff.`)
} else if (
  JSON.stringify(JSON.parse(readFileSync(snapshotPath, 'utf8'))) !== JSON.stringify(actual)
) {
  problems.push(
    `the generated config differs from ${snapshotPath}. If the change was intended, run ` +
      '`bun run check:generated-config --update` after a live build and commit the snapshot.\n' +
      text,
  )
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}
console.log('The generated config matches its snapshot, and its Previews name no live resource.')
