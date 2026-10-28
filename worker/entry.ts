// The deployed Worker's entry, built by Nitro as `nitro.entry` in production
// (ADR-0008, ADR-0009). It refuses oversized request bodies before Nitro
// reads them into memory (issue #54), then hands everything else, including
// scheduled events, to Nitro's own Cloudflare module runtime.
import nitro from 'nitropack/presets/cloudflare/runtime/cloudflare-module'
import { withBodyLimits } from '../server/entry/worker'

export default withBodyLimits(nitro)
