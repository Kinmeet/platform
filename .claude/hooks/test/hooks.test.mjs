// Tests for the Kinmeet Claude Code hooks. They use only Node's built-in test
// runner, so they run before the app's dependencies are installed:
//   node --test .claude/hooks/test/
// Every token below is made up. Real-looking values are assembled at run
// time so this file never contains one.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const hooks = join(fileURLToPath(import.meta.url), '..', '..')
const fakeGithubToken = 'ghp_' + 'A1b2C3d4'.repeat(5)
const fakeValue = 'Q9w8E7r6'.repeat(5)

function run(hook, input, env = {}) {
  const result = spawnSync(process.execPath, [join(hooks, hook)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: result.status, stderr: result.stderr }
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'kinmeet-hooks-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q')
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  )
  return { dir, git }
}

const bash = (command, cwd = process.cwd()) =>
  run('guard-bash.mjs', { cwd, tool_input: { command } })
const write = (tool_input) => run('guard-secret-files.mjs', { tool_input })

describe('file guard', () => {
  it('blocks secret files, including .envrc', () => {
    for (const file_path of [
      '/x/.env',
      '/x/.env.local',
      '/x/.dev.vars',
      '/x/.envrc',
      '/x/id_ed25519',
      '/x/key.pem',
    ]) {
      assert.equal(write({ file_path, content: 'A=1' }).status, 2, file_path)
    }
  })

  it('allows example files', () => {
    assert.equal(
      write({ file_path: '/x/.dev.vars.example', content: 'TURNSTILE_SECRET=placeholder' }).status,
      0,
    )
  })

  it('blocks a token in new content without printing it', () => {
    const result = write({ file_path: '/x/a.ts', new_string: `const t = "${fakeGithubToken}"` })
    assert.equal(result.status, 2)
    assert.ok(!result.stderr.includes(fakeGithubToken))
  })

  it('blocks JSON and JSONC keys', () => {
    assert.equal(
      write({ file_path: '/x/wrangler.jsonc', content: `{ "apiToken": "${fakeValue}" }` }).status,
      2,
    )
  })

  it('does not let a variable name hide a real value', () => {
    for (const name of ['latestToken', 'exampleApiKey', 'fakeSecret', 'dummyPassword']) {
      assert.equal(
        write({ file_path: '/x/a.ts', content: `const ${name} = "${fakeValue}"` }).status,
        2,
        name,
      )
    }
  })

  it('allows obvious placeholder values and references', () => {
    assert.equal(
      write({ file_path: '/x/a.ts', content: 'const token = "fake-token-for-tests-0000000000"' })
        .status,
      0,
    )
    assert.equal(write({ file_path: '/x/a.ts', content: 'const apiKey = env.API_KEY' }).status, 0)
  })

  it('checks GitHub tools that commit files directly', () => {
    assert.equal(write({ path: '.env', content: 'A=1' }).status, 2)
    assert.equal(
      write({ files: [{ path: 'ok.ts', content: `x = "${fakeGithubToken}"` }] }).status,
      2,
    )
    assert.equal(write({ files: [{ path: 'ok.ts', content: 'export {}' }] }).status, 0)
  })

  it('blocks when the input cannot be read', () => {
    const result = spawnSync(process.execPath, [join(hooks, 'guard-secret-files.mjs')], {
      input: '{not json',
      encoding: 'utf8',
    })
    assert.equal(result.status, 2)
  })
})

describe('Bash guard: secret files', () => {
  it('blocks writing, copying, editing and reading secret files', () => {
    for (const command of [
      'echo A=1 > .dev.vars',
      'echo A=1 | tee .env',
      'cp x .env',
      'mv x .envrc',
      "sed -i 's/a/b/' .env.local",
      'cat .env',
      'grep TOKEN .dev.vars',
      'head -n1 config/.env',
      'source .envrc',
      'some-tool --env-file=.env',
    ]) {
      assert.equal(bash(command).status, 2, command)
    }
  })

  it('allows ordinary commands and example files', () => {
    for (const command of ['ls -la', 'cat .dev.vars.example', 'rm -rf .wrangler', 'git status']) {
      assert.equal(bash(command).status, 0, command)
    }
  })

  it('ignores secret file names mentioned in commit messages and PR bodies', () => {
    assert.equal(
      bash('git commit -m "Block writes to .env files" --allow-empty', repo().dir).status,
      0,
    )
    assert.equal(
      bash('gh pr create --title "Hooks" --body "Never commit .env or use --no-verify"').status,
      0,
    )
    assert.equal(
      bash("git commit -q -F - <<'EOF'\nMention .env and --no-verify\nEOF", repo().dir).status,
      0,
    )
  })
})

describe('Bash guard: commits', () => {
  it('blocks a staged secret', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'a.ts'), `k = "${fakeGithubToken}"\n`)
    git('add', 'a.ts')
    assert.equal(bash('git commit -m x', dir).status, 2)
  })

  it('blocks git add and commit in one command', () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), `k = "${fakeGithubToken}"\n`)
    assert.equal(bash('git add . && git commit -m x', dir).status, 2)
  })

  it('blocks git -C <dir> commit', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'a.ts'), `k = "${fakeGithubToken}"\n`)
    git('add', 'a.ts')
    assert.equal(bash(`git -C ${dir} commit -m x`, tmpdir()).status, 2)
  })

  it('blocks a pathspec commit of a tracked file', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'cfg.ts'), 'export {}\n')
    git('add', 'cfg.ts')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'add')
    writeFileSync(join(dir, 'cfg.ts'), `k = "${fakeGithubToken}"\n`)
    assert.equal(bash('git commit cfg.ts -m x', dir).status, 2)
  })

  it('blocks a staged secret file', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'secrets.json'), '{}\n')
    git('add', '-f', 'secrets.json')
    assert.equal(bash('git commit -m x', dir).status, 2)
  })

  it('allows a clean commit', () => {
    const { dir } = repo()
    writeFileSync(join(dir, 'a.ts'), 'export const ok = true\n')
    assert.equal(bash('git add . && git commit -m x', dir).status, 0)
  })
})

describe('Bash guard: pushes and deploys', () => {
  it('blocks pushes to main but not to branches named like main', () => {
    assert.equal(bash('git push -u origin main').status, 2)
    assert.equal(bash('git push origin HEAD:main && echo').status, 2)
    assert.equal(bash('git push origin main-fix', repo().dir).status, 0)
  })

  it('blocks a push that would publish a secret', () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'a.ts'), `k = "${fakeGithubToken}"\n`)
    git('add', 'a.ts')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'oops')
    assert.equal(bash('git push -u origin platform/1-x', dir).status, 2)
  })

  it('blocks skipping git hooks', () => {
    assert.equal(bash('git commit --no-verify -m x').status, 2)
    assert.equal(bash('git commit -n -m x').status, 2)
  })

  it('blocks live deploys by hand in any spelling', () => {
    for (const command of [
      'wrangler deploy --env live',
      'bunx wrangler deploy --env=live',
      'npx wrangler deploy -e live',
      'bun run wrangler versions deploy --env live',
    ]) {
      assert.equal(bash(command).status, 2, command)
    }
    assert.equal(bash('bunx wrangler deploy --env staging').status, 0)
  })
})

// The staging and live DB ids from wrangler.jsonc, which agents may use.
const projectDir = join(hooks, '..', '..')
const stagingDbId = '18c80f5f-3c72-4781-8d38-98ef6cc4a096'
const liveDbId = '3b253758-831e-4db9-bb90-fb4598f215db'
const guardEnv = { CLAUDE_PROJECT_DIR: projectDir }
const sgBash = (command, cwd = projectDir) =>
  run('guard-bash.mjs', { cwd, tool_input: { command } }, guardEnv)
const cloudflare = (tool_name, tool_input) =>
  run('guard-cloudflare.mjs', { tool_name, tool_input }, guardEnv)

describe('safeguarding store: Bash', () => {
  it('blocks remote D1 commands that touch the safeguarding table', () => {
    for (const command of [
      'bunx wrangler d1 execute DB --env live --remote --command "SELECT * FROM safeguarding_items"',
      'bunx wrangler d1 execute kinmeet-staging --remote --command "DROP TRIGGER safeguarding_items_no_delete"',
      'wrangler d1 execute DB --remote --env live --command "delete from SAFEGUARDING_ITEMS"',
      `curl -X POST https://api.cloudflare.com/client/v4/accounts/x/d1/database/${stagingDbId}/query -d '{"sql":"SELECT * FROM safeguarding_items"}'`,
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
  })

  it('reads the SQL in a --file for a remote D1 command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kinmeet-sql-'))
    writeFileSync(join(dir, 'q.sql'), 'DELETE FROM safeguarding_items;\n')
    writeFileSync(join(dir, 'ok.sql'), 'SELECT count(*) FROM form_submissions;\n')
    for (const command of [
      'bunx wrangler d1 execute DB --remote --file q.sql',
      'bunx wrangler d1 execute DB --remote --file=q.sql',
      'bunx wrangler d1 execute DB --remote --file "q.sql"',
    ]) {
      const result = sgBash(command, dir)
      assert.equal(result.status, 2, command)
      // Refused for the SQL in the file, not because the hook failed.
      assert.match(result.stderr, /safeguarding_items table/, command)
    }
    // `--env staging`: with no environment named, `DB` counts as live (#112).
    assert.equal(
      sgBash('bunx wrangler d1 execute DB --remote --env staging --file ok.sql', dir).status,
      0,
    )
  })

  it('blocks wrangler secret commands on a safeguarding key in every environment', () => {
    for (const command of [
      'bunx wrangler secret put SAFEGUARDING_KEY --env live',
      'bunx wrangler secret put SAFEGUARDING_KEY --env staging',
      'bunx wrangler secret delete SAFEGUARDING_KEY_PREVIOUS --env live',
      'echo v1.x | npx wrangler versions secret put SAFEGUARDING_KEY --env staging',
      'bunx wrangler secret bulk keys.json # SAFEGUARDING_KEY',
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
  })

  it('reads the secrets file given to wrangler secret bulk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kinmeet-secrets-'))
    writeFileSync(join(dir, 'keys.json'), '{ "SAFEGUARDING_KEY": "v1.made-up" }\n')
    writeFileSync(join(dir, 'other.json'), '{ "MADE_UP_SECRET": "x" }\n')
    for (const command of [
      'bunx wrangler secret bulk keys.json --env live',
      'bunx wrangler secret bulk --env live keys.json',
      'bunx wrangler versions secret bulk "keys.json" --env staging',
      // Secrets from standard input, or a missing file, cannot be checked.
      'cat keys.json | bunx wrangler secret bulk --env live',
      'bunx wrangler secret bulk missing.json --env live',
    ]) {
      assert.equal(sgBash(command, dir).status, 2, command)
    }
    assert.equal(sgBash('bunx wrangler secret bulk other.json --env staging', dir).status, 0)
  })

  it('blocks a Time Travel restore of a live database', () => {
    for (const command of [
      'bunx wrangler d1 time-travel restore DB --env live --timestamp 1',
      'bunx wrangler d1 time-travel restore DB -e live --bookmark x',
      'bunx wrangler d1 time-travel restore kinmeet-live --timestamp 1',
      `curl -X POST https://api.cloudflare.com/client/v4/accounts/x/d1/database/${liveDbId}/time_travel/restore`,
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
    // `time-travel info` on live is refused by the live data check (#111), so
    // the allowed case here is staging.
    for (const command of [
      'bunx wrangler d1 time-travel restore DB --env staging --timestamp 1',
      'bunx wrangler d1 time-travel info DB --env staging',
    ]) {
      assert.equal(sgBash(command).status, 0, command)
    }
  })

  it('blocks a Cloudflare API call that sets the key on a live or unseen Worker', () => {
    for (const command of [
      `curl -X PUT https://api.cloudflare.com/client/v4/accounts/x/workers/scripts/platform-live/secrets -d '{"name":"SAFEGUARDING_KEY"}'`,
      `curl -X PUT "https://api.cloudflare.com/client/v4/accounts/x/workers/scripts/$W/secrets" -d '{"name":"SAFEGUARDING_KEY"}'`,
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
  })

  it('checks heredocs and quoted text unless they are a commit message or PR text', () => {
    for (const command of [
      "bun - <<'EOF'\nawait fetch('https://api.cloudflare.com/client/v4/x', { body: 'SELECT * FROM safeguarding_items' })\nEOF",
      'git commit -m x && bunx wrangler d1 execute DB --remote --command "SELECT * FROM safeguarding_items"',
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
    for (const command of [
      "git commit -q -F - <<'EOF'\nNever run wrangler d1 execute DB --remote on safeguarding_items\nEOF",
      'gh pr create --title "Guard the key" --body "Blocks wrangler secret put SAFEGUARDING_KEY"',
    ]) {
      assert.equal(sgBash(command).status, 0, command)
    }
  })

  it('allows local work, searches and tests on the store', () => {
    for (const command of [
      'bunx wrangler d1 execute DB --local --command "SELECT count(*) FROM safeguarding_items"',
      'bunx wrangler d1 migrations apply DB --local',
      'grep -rn safeguarding_items server/ migrations/',
      'grep -rn SAFEGUARDING_KEY server/ docs/',
      'bun run test tests/unit/server/safeguarding',
      'bunx wrangler d1 migrations apply kinmeet-staging --env staging --remote',
      'bunx wrangler secret list --env staging',
    ]) {
      assert.equal(sgBash(command).status, 0, command)
    }
  })

  it('allows wrangler d1 only on the DB binding or a main database', () => {
    for (const command of [
      'N=kinmeet-live; bunx wrangler d1 execute "${N}" --remote --command "SELECT 1"',
      'bunx wrangler d1 execute `cat name.txt` --remote',
      'bunx wrangler d1 export some-other-db --remote --output x.sql',
      'bunx wrangler d1 migrations apply OTHER_DB --remote',
      'bunx wrangler d1 time-travel restore other --timestamp 1',
      `curl https://api.cloudflare.com/client/v4/accounts/x/d1/database/$ID/query`,
      'curl https://api.cloudflare.com/client/v4/accounts/x/d1/database/0b5c0000-0000-4000-8000-000000000001/query',
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
    for (const command of [
      'bunx wrangler d1 list',
      'bunx wrangler d1 execute kinmeet-local --local --command "SELECT 1"',
      'bunx wrangler d1 migrations list kinmeet-live --env live --remote',
      'bunx wrangler d1 execute DB --env staging --remote --command "SELECT 1"',
      `bunx wrangler d1 execute ${stagingDbId} --remote --command "SELECT 1"`,
      'curl https://api.cloudflare.com/client/v4/accounts/x/d1/database',
    ]) {
      assert.equal(sgBash(command).status, 0, command)
    }
  })
})

describe('safeguarding store: Cloudflare MCP tools', () => {
  it('reads the main DB ids from the real wrangler.jsonc', async () => {
    const { allowedDatabaseIds } = await import('../lib/safeguarding.mjs')
    const allowed = allowedDatabaseIds(projectDir)
    // If this fails, the wrangler.jsonc layout changed and every D1 tool call would be refused.
    assert.ok(allowed.has(stagingDbId))
    assert.ok(![...allowed].some((id) => /^[0-]+$/.test(id)))
  })

  it('blocks any call that touches the safeguarding table', () => {
    const code = `await cf.post('/accounts/x/d1/database/${stagingDbId}/query', { sql: 'SELECT * FROM safeguarding_items' })`
    assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 2)
    const query = cloudflare('mcp__Cloudflare_Developer_Platform__d1_database_query', {
      database_id: stagingDbId,
      sql: 'DELETE FROM safeguarding_items',
    })
    assert.equal(query.status, 2)
  })

  it('blocks the key on the live Worker or a Worker built at run time', () => {
    for (const code of [
      "await cf.put('/accounts/x/workers/scripts/platform-live/secrets', { name: 'SAFEGUARDING_KEY' })",
      "await cf.put('/accounts/x/workers/scripts/kinmeet-live/secrets', { name: 'SAFEGUARDING_KEY_PREVIOUS' })",
      "await cf.put(`/accounts/x/workers/scripts/${w}/secrets`, { name: 'SAFEGUARDING_KEY' })",
      "const s = await cf.get('/accounts/x/workers/scripts/platform-staging/secrets'); await cf.put('/accounts/x/workers/scripts/platform-live/secrets', { name: 'SAFEGUARDING_KEY' })",
      // Naming the staging Worker in a comment does not make a built path safe.
      "const w = 'platform-' + 'li' + 've' // platform-staging\nawait cf.put(`/accounts/x/workers/scripts/${w}/secrets`, { name: 'SAFEGUARDING_KEY' })",
      "await cf.put('/accounts/x/workers/scripts/' + w + '/secrets', { name: 'SAFEGUARDING_KEY' }) // platform-staging",
      "await cf.put('/accounts/x/workers/scripts/platform-staging-copy/secrets', { name: 'SAFEGUARDING_KEY' })",
      "await cf.put(path, { name: 'SAFEGUARDING_KEY' }) // platform-staging",
    ]) {
      assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 2, code)
    }
  })

  it('blocks a Time Travel restore of a live database', () => {
    const code = `await cf.post('/accounts/x/d1/database/${liveDbId}/time_travel/restore', {})`
    assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 2)
    const staging = `await cf.post('/accounts/x/d1/database/${stagingDbId}/time_travel/restore', {})`
    assert.equal(cloudflare('mcp__cloudflare__execute', { code: staging }).status, 0)
  })

  it('allows the staging key to be generated in the Cloudflare runtime', () => {
    const code = [
      'const raw = crypto.getRandomValues(new Uint8Array(32))',
      "await cf.put('/accounts/x/workers/scripts/platform-staging/secrets', { name: 'SAFEGUARDING_KEY', text: 'v1.' + btoa(String.fromCharCode(...raw)), type: 'secret_text' })",
    ].join('\n')
    assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 0)
  })

  it('blocks D1 API calls on any id that is not a literal main DB id', () => {
    const otherId = '0b5c0000-0000-4000-8000-000000000001'
    for (const code of [
      `await cf.post('/accounts/x/d1/database/${otherId}/query', { sql: 'SELECT 1' })`,
      // Listing the databases and looping over them names no database at all.
      [
        "const list = await cf.get('/accounts/x/d1/database')",
        'for (const d of list) await cf.post(`/accounts/x/d1/database/${d.uuid}/query`, { sql: "SELECT 1" })',
      ].join('\n'),
      "await cf.post('/accounts/x/d1/database/' + id + '/query', {})",
      `await cf.post(\`/accounts/x/d1/database/${stagingDbId}\${suffix}\`, {})`,
    ]) {
      assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 2, code)
    }
    const list = "const list = await cf.get('/accounts/x/d1/database')"
    assert.equal(cloudflare('mcp__cloudflare__execute', { code: list }).status, 0)
  })

  it('blocks the D1 tools on an unknown database', () => {
    for (const tool of [
      'mcp__Cloudflare_Developer_Platform__d1_database_query',
      'mcp__Cloudflare_Developer_Platform__d1_database_get',
      'mcp__Cloudflare_Developer_Platform__d1_database_delete',
    ]) {
      const result = cloudflare(tool, {
        database_id: '0b5c0000-0000-4000-8000-000000000001',
        sql: 'SELECT 1',
      })
      assert.equal(result.status, 2, tool)
    }
  })

  it('allows the main DB and other Cloudflare calls', () => {
    assert.equal(
      cloudflare('mcp__Cloudflare_Developer_Platform__d1_database_query', {
        database_id: stagingDbId,
        sql: 'SELECT 1',
      }).status,
      0,
    )
    const code = `await cf.post('/accounts/x/d1/database/${stagingDbId}/query', { sql: 'SELECT 1' })`
    assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 0)
    assert.equal(
      cloudflare('mcp__cloudflare__execute', {
        code: "await cf.get('/accounts/x/workers/scripts')",
      }).status,
      0,
    )
    assert.equal(cloudflare('mcp__cloudflare__docs', { query: 'D1 time travel' }).status, 0)
  })
})

describe('live personal data (#111)', () => {
  it('blocks remote D1 commands that could copy or change live data', () => {
    for (const command of [
      'bunx wrangler d1 export DB --env live --remote --output live.sql',
      'bunx wrangler d1 export kinmeet-live --remote --output live.sql',
      `bunx wrangler d1 export ${liveDbId} --remote --output live.sql`,
      'bunx wrangler d1 execute DB --env live --remote --command "SELECT * FROM form_submissions"',
      'bunx wrangler d1 execute DB --env=live --remote --command "SELECT 1"',
      'npx wrangler d1 execute DB -e live --remote --command "SELECT 1"',
      'bunx wrangler d1 execute kinmeet-live --remote --command "SELECT 1"',
      // Without an explicit --local, the hook refuses rather than rely on wrangler's default.
      'bunx wrangler d1 execute kinmeet-live --command "SELECT 1"',
      'bunx wrangler d1 migrations apply DB --env live --remote',
      'bunx wrangler d1 time-travel info DB --env live',
      'bunx wrangler d1 insights kinmeet-live',
      'bunx wrangler d1 delete kinmeet-live',
      'bunx wrangler d1 list && bunx wrangler d1 export DB --env live --remote --output x.sql',
      'scripts/d1-migrate.sh live',
      'bash scripts/d1-migrate.sh "live"',
    ]) {
      const result = sgBash(command)
      assert.equal(result.status, 2, command)
      assert.match(result.stderr, /live/, command)
    }
  })

  it('blocks D1 API calls on a live database other than reading its details', () => {
    const base = `https://api.cloudflare.com/client/v4/accounts/x/d1/database/${liveDbId}`
    for (const command of [
      `curl -X POST ${base}/query -d '{"sql":"SELECT * FROM form_submissions"}'`,
      `curl ${base}/raw -d '{"sql":"SELECT 1"}'`,
      `curl -X POST ${base}/export -d '{"output_format":"polling"}'`,
      `curl -X POST ${base}/import`,
      `curl -X DELETE ${base}`,
      `curl --request PATCH ${base} --data '{}'`,
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
    for (const code of [
      `await cf.post('/accounts/x/d1/database/${liveDbId}/query', { sql: 'SELECT 1' })`,
      `await cloudflare.request({ method: 'POST', path: '/accounts/x/d1/database/${liveDbId}/export', body: {} })`,
      `await cloudflare.request({ method: 'DELETE', path: '/accounts/x/d1/database/${liveDbId}' })`,
      `await cloudflare.request({ method: 'GET', path: '/accounts/x/d1/database/${liveDbId}/time_travel/bookmark' })`,
    ]) {
      assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 2, code)
    }
  })

  it('blocks the Workers Bindings D1 tools on a live database, except getting its details', () => {
    for (const tool of [
      'mcp__Cloudflare_Developer_Platform__d1_database_query',
      'mcp__Cloudflare_Developer_Platform__d1_database_delete',
    ]) {
      const result = cloudflare(tool, { database_id: liveDbId, sql: 'SELECT 1' })
      assert.equal(result.status, 2, tool)
    }
    const get = cloudflare('mcp__Cloudflare_Developer_Platform__d1_database_get', {
      database_id: liveDbId,
    })
    assert.equal(get.status, 0)
  })

  it('allows live metadata, local work and staging', () => {
    for (const command of [
      'bunx wrangler d1 migrations list DB --env live --remote',
      'bunx wrangler d1 migrations list kinmeet-live --remote',
      'bunx wrangler d1 info kinmeet-live',
      `bunx wrangler d1 info ${liveDbId}`,
      'bunx wrangler d1 execute DB --env live --local --command "SELECT 1"',
      'bunx wrangler d1 export DB --env staging --remote --output staging.sql',
      'bunx wrangler d1 migrations apply DB --env staging --remote',
      'scripts/d1-migrate.sh staging',
      `curl https://api.cloudflare.com/client/v4/accounts/x/d1/database/${liveDbId}`,
      'grep -rn "wrangler d1 export" docs/',
      'gh pr create --title "Guard live data" --body "Refuses wrangler d1 export DB --env live --remote"',
    ]) {
      assert.equal(sgBash(command).status, 0, command)
    }
    for (const code of [
      `await cloudflare.request({ method: 'GET', path: '/accounts/x/d1/database/${liveDbId}' })`,
      `await cf.post('/accounts/x/d1/database/${stagingDbId}/query', { sql: 'SELECT 1' })`,
    ]) {
      assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 0, code)
    }
  })

  it('reads the live database from the real wrangler.jsonc', async () => {
    const { liveDatabases } = await import('../lib/safeguarding.mjs')
    // If this fails, the wrangler.jsonc layout changed and the live checks would see nothing.
    assert.ok(liveDatabases(projectDir).ids.has(liveDbId))
    assert.ok(liveDatabases(projectDir).names.has('kinmeet-live'))
  })

  it('counts a database command with no staging environment as live (#112)', () => {
    for (const command of [
      'CLOUDFLARE_ENV=live bunx wrangler d1 execute DB --remote --command "select 1"',
      'export CLOUDFLARE_ENV=live && bunx wrangler d1 export DB --remote --output x.sql',
      'bunx wrangler d1 execute DB --remote --command "select 1"',
      'bunx wrangler d1 export DB --remote --output x.sql',
      'CLOUDFLARE_ENV=live bunx wrangler d1 execute DB --env staging --remote --command "select 1"',
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
    for (const command of [
      'bunx wrangler d1 execute DB --env staging --remote --command "select 1"',
      'bunx wrangler d1 execute kinmeet-staging --remote --command "select 1"',
      `bunx wrangler d1 execute ${stagingDbId} --remote --command "select 1"`,
      'bunx wrangler d1 execute DB --local --command "select 1"',
      'bunx wrangler d1 list',
      'bunx wrangler d1 migrations list DB',
    ]) {
      assert.equal(sgBash(command).status, 0, command)
    }
  })
})

describe('Bash guard: commit scan', () => {
  it('skips an untracked symlink to a directory instead of failing', () => {
    const { dir } = repo()
    const target = mkdtempSync(join(tmpdir(), 'kinmeet-linked-'))
    symlinkSync(target, join(dir, 'node_modules_link'))
    const result = bash('git commit -m "Test commit"', dir)
    assert.equal(result.status, 0, result.stderr)
  })
})
