import { limitRequestBody } from './body-limit'

/** The parts of a Worker module that the entry touches. */
export interface WorkerModule {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> | Response
  [handler: string]: unknown
}

/**
 * Wraps Nitro's Worker module, as worker/entry.ts does. Only `fetch` changes: it
 * refuses oversized bodies first (issue #54). Every other handler Nitro
 * exports, such as `scheduled` for the deletion job, is passed through as it
 * is.
 */
export function withBodyLimits<Module extends WorkerModule>(nitro: Module): Module {
  return {
    ...nitro,
    async fetch(request: Request, env: unknown, ctx: unknown) {
      const checked = await limitRequestBody(request)
      if (checked instanceof Response) return checked
      return nitro.fetch(checked, env, ctx)
    },
  }
}
