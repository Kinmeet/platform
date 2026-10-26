import { crossesFormBoundary } from '#shared/routes'

// Each document gets its security policy from the path it was loaded on, and
// only form pages may load Cloudflare's spam check (S5, P5). A link that goes
// onto or off a form page therefore loads a fresh document, so the form gets
// a policy that allows the spam check and other pages never keep it (#20).
export default defineNuxtRouteMiddleware((to, from) => {
  if (import.meta.server || useNuxtApp().isHydrating) return
  if (crossesFormBoundary(to.path, from.path)) {
    return navigateTo(to.fullPath, { external: true })
  }
})
