// The deployed Worker's entry (wrangler.jsonc `main`). It refuses oversized
// request bodies before Nitro reads them into memory (issue #54), then hands
// everything else to the Nuxt server built by `bun run build`.
import nitro from '../.output/server/index.mjs'
import { withBodyLimits } from '../server/entry/worker'

export default withBodyLimits(nitro)
