// The environments a Workers Builds build may target (ADR-0009). After a
// build, Wrangler reads the generated config and ignores `--env`, so the
// environment comes only from the CLOUDFLARE_ENV build variable. `staging`
// stays while env.staging (the old `platform-staging` Worker) exists.
export const DEPLOY_ENVIRONMENTS = ['live', 'staging'] as const

/**
 * Why this build must stop, or null. Outside Workers Builds (`WORKERS_CI=1`)
 * anything goes, so local builds and CI keep the local top-level config.
 */
export function deployEnvironmentProblem(env: Record<string, string | undefined>): string | null {
  if (env.WORKERS_CI !== '1') return null
  const target = env.CLOUDFLARE_ENV
  if (target && (DEPLOY_ENVIRONMENTS as readonly string[]).includes(target)) return null
  return (
    `CLOUDFLARE_ENV is ${target ? `"${target}"` : 'not set'}. Workers Builds must set it to ` +
    `${DEPLOY_ENVIRONMENTS.join(' or ')}, or the build would deploy the local config (ADR-0009).`
  )
}
