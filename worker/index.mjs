// The deployed Worker's entry (wrangler.jsonc `main`). It refuses oversized
// request bodies before Nitro reads them into memory (issue #54), then hands
// everything else to the Nuxt server built by `bun run build`.
import nitro from '../.output/server/index.mjs'
import { limitRequestBody } from '../server/entry/body-limit'

export default {
  ...nitro,
  async fetch(request, env, ctx) {
    const checked = await limitRequestBody(request)
    if (checked instanceof Response) return checked
    return nitro.fetch(checked, env, ctx)
  },
}
