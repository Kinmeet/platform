// Fails if user-facing text uses words the handbook bans (rule 4). All
// user-facing text lives in the translation files, so those are checked.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bannedTerms as banned } from '../shared/copy/banned-terms'

const localesDir = join(import.meta.dirname, '..', 'i18n', 'locales')
const problems: string[] = []

for (const file of await readdir(localesDir)) {
  const lines = (await readFile(join(localesDir, file), 'utf8')).split('\n')
  lines.forEach((line, index) => {
    for (const { pattern, use } of banned) {
      const match = line.match(pattern)
      if (match)
        problems.push(`${file}:${index + 1}: "${match[0]}" is not used at Kinmeet, use ${use}`)
    }
  })
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('Copy check passed: no banned terms in the translation files.')
