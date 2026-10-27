// Helpers for tests: a made-up Access team, signing keys and tokens.

export const TEAM = 'kinmeet-test.cloudflareaccess.com'
export const AUD = 'test-audience-tag'
export const NOW = 1_800_000_000

function base64Url(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function makeKey(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } }
}

export async function signToken(
  key: { kid: string; privateKey: CryptoKey },
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
) {
  const head = base64Url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }))
  const body = base64Url(
    JSON.stringify({
      aud: [AUD],
      iss: `https://${TEAM}`,
      sub: '00000000-0000-4000-8000-00000000f00d',
      iat: NOW - 10,
      nbf: NOW - 10,
      exp: NOW + 3600,
      ...claims,
    }),
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    ),
  )
  return `${head}.${body}.${base64Url(signature)}`
}

export function certsFetcher(keys: JsonWebKey[], calls: string[] = []) {
  return (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify({ keys }))
  }) as typeof fetch
}
