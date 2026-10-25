// Tests for the Kinmeet Claude Code hooks. They use only Node's built-in test
// runner, so they run before the app's dependencies are installed:
//   node --test .claude/hooks/test/
// Every token below is made up. Real-looking values are assembled at run
// time so this file never contains one.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const hooks = join(fileURLToPath(import.meta.url), '..', '..');
const fakeGithubToken = 'ghp_' + 'A1b2C3d4'.repeat(5);
const fakeValue = 'Q9w8E7r6'.repeat(5);

function run(hook, input) {
  const result = spawnSync(process.execPath, [join(hooks, hook)], { input: JSON.stringify(input), encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'kinmeet-hooks-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, git };
}

const bash = (command, cwd = process.cwd()) => run('guard-bash.mjs', { cwd, tool_input: { command } });
const write = (tool_input) => run('guard-secret-files.mjs', { tool_input });

describe('file guard', () => {
  it('blocks secret files, including .envrc', () => {
    for (const file_path of ['/x/.env', '/x/.env.local', '/x/.dev.vars', '/x/.envrc', '/x/id_ed25519', '/x/key.pem']) {
      assert.equal(write({ file_path, content: 'A=1' }).status, 2, file_path);
    }
  });

  it('allows example files', () => {
    assert.equal(write({ file_path: '/x/.dev.vars.example', content: 'TURNSTILE_SECRET=placeholder' }).status, 0);
  });

  it('blocks a token in new content without printing it', () => {
    const result = write({ file_path: '/x/a.ts', new_string: `const t = "${fakeGithubToken}"` });
    assert.equal(result.status, 2);
    assert.ok(!result.stderr.includes(fakeGithubToken));
  });

  it('blocks JSON and JSONC keys', () => {
    assert.equal(write({ file_path: '/x/wrangler.jsonc', content: `{ "apiToken": "${fakeValue}" }` }).status, 2);
  });

  it('does not let a variable name hide a real value', () => {
    for (const name of ['latestToken', 'exampleApiKey', 'fakeSecret', 'dummyPassword']) {
      assert.equal(write({ file_path: '/x/a.ts', content: `const ${name} = "${fakeValue}"` }).status, 2, name);
    }
  });

  it('allows obvious placeholder values and references', () => {
    assert.equal(write({ file_path: '/x/a.ts', content: 'const token = "fake-token-for-tests-0000000000"' }).status, 0);
    assert.equal(write({ file_path: '/x/a.ts', content: 'const apiKey = env.API_KEY' }).status, 0);
  });

  it('checks GitHub tools that commit files directly', () => {
    assert.equal(write({ path: '.env', content: 'A=1' }).status, 2);
    assert.equal(write({ files: [{ path: 'ok.ts', content: `x = "${fakeGithubToken}"` }] }).status, 2);
    assert.equal(write({ files: [{ path: 'ok.ts', content: 'export {}' }] }).status, 0);
  });

  it('blocks when the input cannot be read', () => {
    const result = spawnSync(process.execPath, [join(hooks, 'guard-secret-files.mjs')], { input: '{not json', encoding: 'utf8' });
    assert.equal(result.status, 2);
  });
});

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
      assert.equal(bash(command).status, 2, command);
    }
  });

  it('allows ordinary commands and example files', () => {
    for (const command of ['ls -la', 'cat .dev.vars.example', 'rm -rf .wrangler', 'git status']) {
      assert.equal(bash(command).status, 0, command);
    }
  });

  it('ignores secret file names mentioned in commit messages and PR bodies', () => {
    assert.equal(bash('git commit -m "Block writes to .env files" --allow-empty', repo().dir).status, 0);
    assert.equal(bash('gh pr create --title "Hooks" --body "Never commit .env or use --no-verify"').status, 0);
    assert.equal(bash("git commit -q -F - <<'EOF'\nMention .env and --no-verify\nEOF", repo().dir).status, 0);
  });
});

describe('Bash guard: commits', () => {
  it('blocks a staged secret', () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, 'a.ts'), `k = "${fakeGithubToken}"\n`);
    git('add', 'a.ts');
    assert.equal(bash('git commit -m x', dir).status, 2);
  });

  it('blocks git add and commit in one command', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'a.ts'), `k = "${fakeGithubToken}"\n`);
    assert.equal(bash('git add . && git commit -m x', dir).status, 2);
  });

  it('blocks git -C <dir> commit', () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, 'a.ts'), `k = "${fakeGithubToken}"\n`);
    git('add', 'a.ts');
    assert.equal(bash(`git -C ${dir} commit -m x`, tmpdir()).status, 2);
  });

  it('blocks a pathspec commit of a tracked file', () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, 'cfg.ts'), 'export {}\n');
    git('add', 'cfg.ts');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'add');
    writeFileSync(join(dir, 'cfg.ts'), `k = "${fakeGithubToken}"\n`);
    assert.equal(bash('git commit cfg.ts -m x', dir).status, 2);
  });

  it('blocks a staged secret file', () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, 'secrets.json'), '{}\n');
    git('add', '-f', 'secrets.json');
    assert.equal(bash('git commit -m x', dir).status, 2);
  });

  it('allows a clean commit', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'a.ts'), 'export const ok = true\n');
    assert.equal(bash('git add . && git commit -m x', dir).status, 0);
  });
});

describe('Bash guard: pushes and deploys', () => {
  it('blocks pushes to main but not to branches named like main', () => {
    assert.equal(bash('git push -u origin main').status, 2);
    assert.equal(bash('git push origin HEAD:main && echo').status, 2);
    assert.equal(bash('git push origin main-fix', repo().dir).status, 0);
  });

  it('blocks a push that would publish a secret', () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, 'a.ts'), `k = "${fakeGithubToken}"\n`);
    git('add', 'a.ts');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'oops');
    assert.equal(bash('git push -u origin platform/1-x', dir).status, 2);
  });

  it('blocks skipping git hooks', () => {
    assert.equal(bash('git commit --no-verify -m x').status, 2);
    assert.equal(bash('git commit -n -m x').status, 2);
  });

  it('blocks live deploys by hand in any spelling', () => {
    for (const command of [
      'wrangler deploy --env live',
      'bunx wrangler deploy --env=live',
      'npx wrangler deploy -e live',
      'bun run wrangler versions deploy --env live',
    ]) {
      assert.equal(bash(command).status, 2, command);
    }
    assert.equal(bash('bunx wrangler deploy --env staging').status, 0);
  });
});
