// Tests for the Kinmeet Claude Code hooks. They use only Node's built-in test
// runner, so they run before the app's dependencies are installed:
//   node --test .claude/hooks/test/
// Every token below is made up. Real-looking values are assembled at run
// time so this file never contains one.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

// Made-up ids: one listed as a safeguarding database for the hooks, and the
// staging DB id from wrangler.jsonc, which agents may use.
const projectDir = join(hooks, '..', '..')
const fakeSafeguardingId = '5afe0000-0000-4000-8000-00000000c0de'
const stagingDbId = '18c80f5f-3c72-4781-8d38-98ef6cc4a096'
const guardEnv = {
  CLAUDE_PROJECT_DIR: projectDir,
  KINMEET_SAFEGUARDING_DB_IDS: fakeSafeguardingId,
  HOME: mkdtempSync(join(tmpdir(), 'kinmeet-home-')),
}
const sgBash = (command) =>
  run('guard-bash.mjs', { cwd: projectDir, tool_input: { command } }, guardEnv)
const cloudflare = (tool_name, tool_input) =>
  run('guard-cloudflare.mjs', { tool_name, tool_input }, guardEnv)

describe('safeguarding databases: Bash', () => {
  it('blocks wrangler d1 commands on a safeguarding database in every form', () => {
    for (const command of [
      'bunx wrangler d1 execute kinmeet-live-safeguarding --remote --command "SELECT 1"',
      'wrangler d1 execute SAFEGUARDING_DB --env live --remote --file q.sql',
      'npx wrangler d1 export kinmeet-staging-safeguarding --remote --output x.sql',
      'bunx wrangler d1 migrations apply SAFEGUARDING_DB --env staging --remote',
      'bunx wrangler d1 migrations list kinmeet-preview-safeguarding',
      'bunx wrangler d1 time-travel restore kinmeet-live-safeguarding --timestamp 1',
      'bunx wrangler d1 info Kinmeet-Live-Safeguarding',
      `bunx wrangler d1 execute ${fakeSafeguardingId} --remote --command "SELECT 1"`,
      `curl https://api.cloudflare.com/client/v4/accounts/x/d1/database/${fakeSafeguardingId}/query`,
      'curl -X POST https://api.cloudflare.com/client/v4/accounts/x/d1/database?name=kinmeet-live-safeguarding',
    ]) {
      assert.equal(sgBash(command).status, 2, command)
    }
  })

  it('blocks a safeguarding id wherever it appears', () => {
    assert.equal(sgBash(`echo ${fakeSafeguardingId} | xargs some-tool`).status, 2)
  })

  it('allows the main DB and code that only names the binding', () => {
    for (const command of [
      'bunx wrangler d1 execute DB --env staging --remote --command "SELECT 1"',
      'bunx wrangler d1 migrations apply kinmeet-staging --env staging --remote',
      `bunx wrangler d1 execute ${stagingDbId} --remote --command "SELECT 1"`,
      'grep -rn SAFEGUARDING_DB server/',
      'bun run test tests/unit/server/safeguarding',
      'git commit -m "Add the kinmeet-live-safeguarding binding to the d1 docs"',
    ]) {
      assert.equal(sgBash(command).status, 0, command)
    }
  })
})

describe('safeguarding databases: Cloudflare MCP tools', () => {
  it('blocks the API tool when its code names a safeguarding database or id', () => {
    for (const code of [
      "const dbs = await cf.get('/accounts/x/d1/database?name=kinmeet-live-safeguarding')",
      `await cf.post('/accounts/x/d1/database/${fakeSafeguardingId}/query', { sql: 'SELECT 1' })`,
      "const db = list.find((d) => d.name.includes('SAFEGUARDING_DB'))",
    ]) {
      assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 2, code)
    }
  })

  it('blocks D1 API calls on any id that is not a main DB', () => {
    const otherId = '0b5c0000-0000-4000-8000-000000000001'
    const code = `await cf.post('/accounts/x/d1/database/${otherId}/query', { sql: 'SELECT 1' })`
    assert.equal(cloudflare('mcp__cloudflare__execute', { code }).status, 2)
  })

  it('blocks the D1 tools on a safeguarding or unknown database', () => {
    for (const database_id of [fakeSafeguardingId, '0b5c0000-0000-4000-8000-000000000001']) {
      for (const tool of [
        'mcp__Cloudflare_Developer_Platform__d1_database_query',
        'mcp__Cloudflare_Developer_Platform__d1_database_get',
        'mcp__Cloudflare_Developer_Platform__d1_database_delete',
      ]) {
        assert.equal(cloudflare(tool, { database_id, sql: 'SELECT 1' }).status, 2, tool)
      }
    }
    const create = cloudflare('mcp__Cloudflare_Developer_Platform__d1_database_create', {
      name: 'kinmeet-live-safeguarding',
    })
    assert.equal(create.status, 2)
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

  it('reads safeguarding ids from a file outside the repository', () => {
    const home = mkdtempSync(join(tmpdir(), 'kinmeet-home-'))
    mkdirSync(join(home, '.kinmeet'))
    const fileId = '5afe0000-0000-4000-8000-00000000f11e'
    writeFileSync(join(home, '.kinmeet', 'safeguarding-db-ids'), `${fileId}\n`)
    const result = run(
      'guard-bash.mjs',
      { cwd: projectDir, tool_input: { command: `bunx wrangler d1 execute ${fileId} --remote` } },
      { ...guardEnv, KINMEET_SAFEGUARDING_DB_IDS: '', HOME: home },
    )
    assert.equal(result.status, 2)
  })
})
