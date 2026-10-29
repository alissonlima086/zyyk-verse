#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseVersion(value) {
  const normalized = String(value ?? '').trim().replace(/^v/, '');
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) throw new Error(`Versão inválida: ${value}. Use MAJOR.MINOR.PATCH.`);
  return { value: normalized, parts: match.slice(1).map(Number) };
}

export function bumpVersion(version, kind = 'patch') {
  const { parts } = parseVersion(version);
  if (kind === 'major') return `${parts[0] + 1}.0.0`;
  if (kind === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  if (kind === 'patch') return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  throw new Error(`Incremento inválido: ${kind}. Use patch, minor ou major.`);
}

export function prepareChangelog(contents, version, previousVersion, date) {
  parseVersion(version);
  parseVersion(previousVersion);
  if (contents.includes(`## [${version}]`)) {
    throw new Error(`O changelog já contém a versão ${version}.`);
  }

  const heading = /^## \[Unreleased\] — Não lançado\s*$/m.exec(contents);
  if (!heading) throw new Error('Seção [Unreleased] — Não lançado ausente.');
  const notesStart = heading.index + heading[0].length;
  const nextVersion = /^## \[\d+\.\d+\.\d+\]/m.exec(contents.slice(notesStart));
  if (!nextVersion) throw new Error('Nenhuma versão anterior encontrada no changelog.');
  const nextVersionStart = notesStart + nextVersion.index;
  const notes = contents.slice(notesStart, nextVersionStart).trim();
  if (!notes.includes('### English') || !notes.includes('### Português')) {
    throw new Error('A seção Unreleased precisa conter notas em inglês e português.');
  }

  const before = contents.slice(0, notesStart).trimEnd();
  const history = contents.slice(nextVersionStart).trimStart();
  let updated = `${before}\n\n## [${version}] - ${date}\n\n${notes}\n\n${history}`;
  const unreleasedLink = /^\[Unreleased\]: .*$/m;
  if (!unreleasedLink.test(updated)) throw new Error('Link [Unreleased] ausente.');
  updated = updated.replace(
    unreleasedLink,
    `[Unreleased]: https://github.com/alissonlima086/zyyk-verse/compare/v${version}...HEAD\n`
      + `[${version}]: https://github.com/alissonlima086/zyyk-verse/compare/v${previousVersion}...v${version}`,
  );
  return `${updated.trimEnd()}\n`;
}

function updateJsonVersion(path, version, updateRootPackage = false) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  data.version = version;
  if (updateRootPackage && data.packages?.['']) data.packages[''].version = version;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function replaceRequired(contents, pattern, replacement, label) {
  if (!pattern.test(contents)) throw new Error(`Versão de ${label} não encontrada.`);
  return contents.replace(pattern, replacement);
}

export function prepareReleaseFiles(root, version, previousVersion, date) {
  const target = parseVersion(version).value;
  const previous = parseVersion(previousVersion).value;
  updateJsonVersion(resolve(root, 'package.json'), target);
  updateJsonVersion(resolve(root, 'package-lock.json'), target, true);
  updateJsonVersion(resolve(root, 'src-tauri/tauri.conf.json'), target);

  const cargoTomlPath = resolve(root, 'src-tauri/Cargo.toml');
  const cargoToml = replaceRequired(
    readFileSync(cargoTomlPath, 'utf8'),
    /(\[package\][\s\S]*?\nversion = ")[^"]+("\s*)/,
    (_match, prefix, suffix) => `${prefix}${target}${suffix}`,
    'src-tauri/Cargo.toml',
  );
  writeFileSync(cargoTomlPath, cargoToml);

  const cargoLockPath = resolve(root, 'src-tauri/Cargo.lock');
  const cargoLock = replaceRequired(
    readFileSync(cargoLockPath, 'utf8'),
    /(\[\[package\]\]\nname = "zyyk-verse"\nversion = ")[^"]+("\s*)/,
    (_match, prefix, suffix) => `${prefix}${target}${suffix}`,
    'src-tauri/Cargo.lock',
  );
  writeFileSync(cargoLockPath, cargoLock);

  const changelogPath = resolve(root, 'CHANGELOG.md');
  const changelog = prepareChangelog(readFileSync(changelogPath, 'utf8'), target, previous, date);
  writeFileSync(changelogPath, changelog);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [version, previousVersion, date = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
  if (!version || !previousVersion) {
    console.error('Uso: node scripts/prepare-release.mjs VERSION VERSAO_ANTERIOR [DATA]');
    process.exit(2);
  }
  prepareReleaseFiles(process.cwd(), version, previousVersion, date);
}
