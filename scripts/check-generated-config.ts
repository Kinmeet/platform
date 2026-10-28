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
//   flags, crons and required secrets differ from the committed snapshot;
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

interface D1 {
  binding: string
  database_name: string
  database_id: string
  migrations_table?: string
}

interface Level {
  name?: string
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
