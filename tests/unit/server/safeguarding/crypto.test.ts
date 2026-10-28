import { describe, expect, it } from 'vitest'
import {
  decryptRecord,
  encryptRecord,
  importSafeguardingKey,
  keyringFrom,
} from '../../../../server/safeguarding/crypto'
import { makeTestKey } from './test-key'

// Nadia's crypto conditions on #95. Made-up keys and text only.
const ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ID = '00000000-0000-4000-8000-000000000002'
const TEXT = 'Made-up disclosure.'

async function keyring(version = 1) {
  const ring = await keyringFrom(makeTestKey(version), undefined)
  if (!ring) throw new Error('test key refused')
  return ring
}

describe('safeguarding keys', () => {
  it('accepts only a versioned 256-bit key', async () => {
    expect(await importSafeguardingKey(undefined)).toBeNull()
    expect(await importSafeguardingKey('')).toBeNull()
    // No version, version 0, and a 128-bit key.
    expect(await importSafeguardingKey(makeTestKey().slice(3))).toBeNull()
    expect(await importSafeguardingKey(makeTestKey().replace(/^v1/, 'v0'))).toBeNull()
    expect(await importSafeguardingKey(`v1.${btoa('made-up 16 bytes')}`)).toBeNull()
    const key = await importSafeguardingKey(`${makeTestKey(7)}\n`)
    expect(key?.version).toBe(7)
  })

  it('imports keys as non-extractable AES-GCM keys', async () => {
    const key = await importSafeguardingKey(makeTestKey())
    expect(key?.key.extractable).toBe(false)
    expect(key?.key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    await expect(crypto.subtle.exportKey('raw', key!.key)).rejects.toThrow()
  })

  it('refuses a previous key that is malformed or not older than the current one', async () => {
    expect(await keyringFrom(makeTestKey(2), 'not-a-key')).toBeNull()
    expect(await keyringFrom(makeTestKey(2), makeTestKey(2))).toBeNull()
    expect(await keyringFrom(makeTestKey(2), makeTestKey(3))).toBeNull()
    expect((await keyringFrom(makeTestKey(2), makeTestKey(1)))?.previous?.version).toBe(1)
  })
})

describe('safeguarding records', () => {
  it('round-trips, with a fresh 96-bit IV every time', async () => {
    const ring = await keyring()
    const first = await encryptRecord(ring, ID, TEXT)
    const second = await encryptRecord(ring, ID, TEXT)
    expect(first.iv.byteLength).toBe(12)
    expect(first.iv).not.toEqual(second.iv)
    expect(first.ciphertext).not.toEqual(second.ciphertext)
    expect(first.keyVersion).toBe(1)
    expect(await decryptRecord(ring, ID, first)).toBe(TEXT)
    expect(new TextDecoder().decode(first.ciphertext)).not.toContain(TEXT)
  })

  it('cannot be moved to another row or relabelled with another key version', async () => {
    const ring = await keyring()
    const record = await encryptRecord(ring, ID, TEXT)
    await expect(decryptRecord(ring, OTHER_ID, record)).rejects.toThrow(
      /^safeguarding_decrypt_failed$/,
    )
    const later = await keyringFrom(makeTestKey(2), undefined)
    await expect(decryptRecord(later!, ID, { ...record, keyVersion: 2 })).rejects.toThrow(
      /^safeguarding_decrypt_failed$/,
    )
  })

  it('refuses a changed ciphertext or IV, and a record for a key it does not hold', async () => {
    const ring = await keyring()
    const record = await encryptRecord(ring, ID, TEXT)
    const flipped = record.ciphertext.slice()
    flipped[0] = flipped[0]! ^ 1
    await expect(decryptRecord(ring, ID, { ...record, ciphertext: flipped })).rejects.toThrow(
      /^safeguarding_decrypt_failed$/,
    )
    const iv = record.iv.slice()
    iv[0] = iv[0]! ^ 1
    await expect(decryptRecord(ring, ID, { ...record, iv })).rejects.toThrow(
      /^safeguarding_decrypt_failed$/,
    )
    await expect(decryptRecord(ring, ID, { ...record, keyVersion: 9 })).rejects.toThrow(
      /^safeguarding_key_unknown$/,
    )
    // Another key with the same version cannot read it either.
    await expect(decryptRecord(await keyring(), ID, record)).rejects.toThrow(
      /^safeguarding_decrypt_failed$/,
    )
  })

  it('reads records under the previous key during a rotation, and writes under the new one', async () => {
    const oldKey = makeTestKey(1)
    const before = await keyringFrom(oldKey, undefined)
    const record = await encryptRecord(before!, ID, TEXT)
    const during = await keyringFrom(makeTestKey(2), oldKey)
    expect(await decryptRecord(during!, ID, record)).toBe(TEXT)
    expect((await encryptRecord(during!, ID, TEXT)).keyVersion).toBe(2)
  })
})
