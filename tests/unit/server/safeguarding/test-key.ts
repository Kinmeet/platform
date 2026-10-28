/**
 * Made-up keys for the safeguarding tests, generated fresh for each run in
 * the same form as the real secret (`v<version>.<base64 of 32 bytes>`).
 */
export function makeTestKey(version = 1): string {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return `v${version}.${btoa(String.fromCharCode(...raw))}`
}
