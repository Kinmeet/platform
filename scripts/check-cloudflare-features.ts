// Fails if Cloudflare could inject scripts or rewrite pages for the Kinmeet
// account (handbook rule 1: no tracking or third-party requests). Workers on
// workers.dev never get zone features, but a custom domain would bring a zone
// and its settings with it, so this check covers zones as soon as one exists.
//
// It checks, read-only:
// - Web Analytics (RUM): no sites in the account. Any site could inject the
//   beacon script.
// - For every zone in the account:
//   - Zaraz: no enabled tools.
//   - Rocket Loader: off (it rewrites script tags and loads its own script).
//   - Email address obfuscation: off (it injects a decoding script).
//   - Automatic Platform Optimization: off.
//
// Run with an API token that can read the account, its zones and Zaraz:
//   CLOUDFLARE_API_TOKEN=... bun scripts/check-cloudflare-features.ts
// Token permissions: Account Settings Read (covers Web Analytics), Zone Read,
// Zone Settings Read, Zaraz Read. Never commit it.

const accountId = '0fa695ccf43f64b3eb9fae94520109b4'
const apiBase = process.env.CLOUDFLARE_API_BASE ?? 'https://api.cloudflare.com/client/v4'
const token = process.env.CLOUDFLARE_API_TOKEN

if (!token) {
  console.error('Set CLOUDFLARE_API_TOKEN to a read-only token for the Kinmeet account.')
  process.exit(2)
}

interface ApiResponse<T> {
  success: boolean
  result: T
  errors: { code: number; message: string }[]
  result_info?: { page: number; total_pages: number }
}

async function get<T>(path: string, query: Record<string, string> = {}): Promise<ApiResponse<T>> {
  const url = new URL(apiBase + path)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const body = (await response.json()) as ApiResponse<T>
  if (!response.ok || !body.success) {
    const errors = body.errors?.map((e) => `${e.code} ${e.message}`).join('; ')
    throw new Error(`GET ${path} failed with ${response.status}: ${errors}`)
  }
  return body
}

async function getAll<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const body = await get<T[]>(path, { ...query, page: String(page), per_page: '50' })
    items.push(...body.result)
    if (!body.result_info || page >= body.result_info.total_pages) return items
  }
}

const problems: string[] = []

const rumSites = await getAll<{ site_tag: string; host?: string }>(
  `/accounts/${accountId}/rum/site_info/list`,
)
for (const site of rumSites) {
  problems.push(`Web Analytics site ${site.host ?? site.site_tag} exists; delete it.`)
}

const zones = await getAll<{ id: string; name: string }>('/zones', { 'account.id': accountId })
for (const zone of zones) {
  const settings = await get<{ id: string; value: unknown }[]>(`/zones/${zone.id}/settings`)
  const value = (id: string) => settings.result.find((s) => s.id === id)?.value
  if (value('rocket_loader') === 'on') problems.push(`${zone.name}: Rocket Loader is on.`)
  if (value('email_obfuscation') === 'on') problems.push(`${zone.name}: email obfuscation is on.`)
  const apo = value('automatic_platform_optimization') as { enabled?: boolean } | undefined
  if (apo?.enabled) problems.push(`${zone.name}: Automatic Platform Optimization is on.`)

  const zaraz = await get<{ tools?: Record<string, { enabled?: boolean; name?: string }> }>(
    `/zones/${zone.id}/settings/zaraz/config`,
  )
  for (const [id, tool] of Object.entries(zaraz.result.tools ?? {})) {
    if (tool.enabled) problems.push(`${zone.name}: Zaraz tool ${tool.name ?? id} is enabled.`)
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(
  `Cloudflare feature check passed: no Web Analytics sites, ${zones.length} zone(s) with no injection features on.`,
)
