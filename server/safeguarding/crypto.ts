/**
 * Encryption for the interim safeguarding store (#36, #95; Nadia's
 * conditions 2 and 3).
 *
 * - AES-256-GCM through Web Crypto, nothing home-made.
 * - A random 96-bit IV for every record, never reused.
 * - Additional authenticated data binds the record id and the key version,
 *   so a row's ciphertext cannot be moved to another row or relabelled.
 * - Keys are imported as non-extractable.
 *
 * A key is a Worker secret in the form `v<version>.<base64 of 32 random
 * bytes>`, for example made with
 * `printf 'v1.%s' "$(openssl rand -base64 32)"`. The version travels with
 * the key, so a record always says which key it needs. During a rotation the
 * old key stays readable as the previous key
 * (docs/runbooks/rotate-safeguarding-key.md).
 *
 * Nothing here ever logs or throws anything from a record: errors carry a
 * code only.
 */

export interface SafeguardingKey {
  version: number
  key: CryptoKey
}

/** The key new records use, and optionally the one before it, during a rotation. */
export interface SafeguardingKeyring {
  current: SafeguardingKey
  previous?: SafeguardingKey
}

export interface EncryptedRecord {
  keyVersion: number
  iv: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
}

const KEY_FORMAT = /^v([1-9]\d{0,5})\.([A-Za-z0-9+/]{43}=)$/
const IV_BYTES = 12

/** Reads a key secret, or `null` if it is missing or not in the expected form. */
export async function importSafeguardingKey(
  value: string | undefined,
): Promise<SafeguardingKey | null> {
  const match = KEY_FORMAT.exec(value?.trim() ?? '')
  if (!match) return null
  const raw = Uint8Array.from(atob(match[2]!), (char) => char.charCodeAt(0))
  if (raw.byteLength !== 32) return null
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
  return { version: Number(match[1]), key }
}

/**
 * The keyring from the two secrets, or `null` if the current key is missing
 * or malformed. A malformed previous key also refuses, so a rotation never
 * goes ahead half set up.
 */
export async function keyringFrom(
  current: string | undefined,
  previous: string | undefined,
): Promise<SafeguardingKeyring | null> {
  const currentKey = await importSafeguardingKey(current)
  if (!currentKey) return null
  if (previous === undefined || previous === '') return { current: currentKey }
  const previousKey = await importSafeguardingKey(previous)
  if (!previousKey || previousKey.version >= currentKey.version) return null
  return { current: currentKey, previous: previousKey }
}

function additionalData(id: string, keyVersion: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`kinmeet:safeguarding_items:${id}:v${keyVersion}`)
}

export async function encryptRecord(
  keyring: SafeguardingKeyring,
  id: string,
  plaintext: string,
): Promise<EncryptedRecord> {
  const { version, key } = keyring.current
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(id, version), tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { keyVersion: version, iv, ciphertext: new Uint8Array(ciphertext) }
}

/**
 * Decrypts one record. Throws `safeguarding_key_unknown` if neither key has
 * its version, and `safeguarding_decrypt_failed` if the ciphertext, IV, id
 * or version have been changed.
 */
export async function decryptRecord(
  keyring: SafeguardingKeyring,
  id: string,
  record: EncryptedRecord,
): Promise<string> {
  const key = [keyring.current, keyring.previous].find((k) => k?.version === record.keyVersion)
  if (!key) throw new Error('safeguarding_key_unknown')
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: record.iv,
        additionalData: additionalData(id, record.keyVersion),
        tagLength: 128,
      },
      key.key,
      record.ciphertext,
    )
  } catch {
    throw new Error('safeguarding_decrypt_failed')
  }
  return new TextDecoder().decode(plaintext)
}
