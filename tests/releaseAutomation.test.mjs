import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  bumpVersion,
  parseVersion,
  prepareChangelog,
  prepareReleaseFiles,
} from '../scripts/prepare-release.mjs';

test('calcula versões patch, minor e major', () => {
  assert.equal(bumpVersion('0.1.4', 'patch'), '0.1.5');
  assert.equal(bumpVersion('0.1.4', 'minor'), '0.2.0');
  assert.equal(bumpVersion('0.1.4', 'major'), '1.0.0');
  assert.equal(parseVersion('v2.3.4').value, '2.3.4');
});

test('promove notas bilíngues de Unreleased e atualiza comparações', () => {
  const input = `# Changelog

## [Unreleased] — Não lançado

### English

#### Added

- New feature.

### Português

#### Adicionado

- Nova funcionalidade.

## [0.1.4] - 2026-10-29

[Unreleased]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.4...HEAD
[0.1.4]: https://example.test
`;
  const output = prepareChangelog(input, '0.1.5', '0.1.4', '2026-10-30');
  assert.match(output, /## \[Unreleased\] — Não lançado\n\n## \[0\.1\.5\] - 2026-10-30/);
  assert.match(output, /\[Unreleased\]: .*compare\/v0\.1\.5\.\.\.HEAD/);
  assert.match(output, /\[0\.1\.5\]: .*compare\/v0\.1\.4\.\.\.v0\.1\.5/);
  assert.match(output, /### English[\s\S]*### Português/);
});

test('recusa promover notas sem os dois idiomas', () => {
  const input = `## [Unreleased] — Não lançado

### English

- Only English.

## [0.1.4] - 2026-10-29

[Unreleased]: https://example.test
`;
  assert.throws(
    () => prepareChangelog(input, '0.1.5', '0.1.4', '2026-10-30'),
    /inglês e português/,
  );
});

test('atualiza todos os manifestos e o changelog do release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zyyk-release-'));
  await mkdir(join(root, 'src-tauri'));
  await writeFile(join(root, 'package.json'), '{"name":"zyyk-verse","version":"0.1.4"}\n');
  await writeFile(
    join(root, 'package-lock.json'),
    '{"name":"zyyk-verse","version":"0.1.4","packages":{"":{"version":"0.1.4"}}}\n',
  );
  await writeFile(join(root, 'src-tauri/tauri.conf.json'), '{"version":"0.1.4"}\n');
  await writeFile(
    join(root, 'src-tauri/Cargo.toml'),
    '[package]\nname = "zyyk-verse"\nversion = "0.1.4"\n\n[dependencies]\n',
  );
  await writeFile(
    join(root, 'src-tauri/Cargo.lock'),
    '[[package]]\nname = "dependency"\nversion = "9.9.9"\n\n[[package]]\nname = "zyyk-verse"\nversion = "0.1.4"\n',
  );
  await writeFile(
    join(root, 'CHANGELOG.md'),
    `# Changelog

## [Unreleased] — Não lançado

### English

- New release workflow.

### Português

- Novo fluxo de lançamento.

## [0.1.4] - 2026-10-29

[Unreleased]: https://github.com/alissonlima086/zyyk-verse/compare/v0.1.4...HEAD
[0.1.4]: https://example.test
`,
  );

  prepareReleaseFiles(root, '0.1.5', '0.1.4', '2026-10-30');

  assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '0.1.5');
  const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  assert.equal(packageLock.version, '0.1.5');
  assert.equal(packageLock.packages[''].version, '0.1.5');
  assert.equal(
    JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version,
    '0.1.5',
  );
  assert.match(await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8'), /version = "0\.1\.5"/);
  assert.match(
    await readFile(join(root, 'src-tauri/Cargo.lock'), 'utf8'),
    /name = "zyyk-verse"\nversion = "0\.1\.5"/,
  );
  assert.match(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), /## \[0\.1\.5\] - 2026-10-30/);
});
