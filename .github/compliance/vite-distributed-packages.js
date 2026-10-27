// @ts-nocheck -- plugin Node executado apenas pelo Vite; não integra o bundle da aplicação.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;

function packageRoot(moduleId) {
  const cleanId = moduleId.split('?')[0];
  if (!isAbsolute(cleanId)) return null;
  let current = dirname(cleanId);
  const filesystemRoot = parse(current).root;
  while (current !== filesystemRoot) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest) && current.includes('/node_modules/')) return current;
    current = dirname(current);
  }
  return null;
}

function repositoryUrl(repository) {
  if (typeof repository === 'string') return repository;
  return repository?.url ?? null;
}

export function distributedPackages() {
  const roots = new Set();
  return {
    name: 'zyyk-distributed-package-inventory',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const moduleId of Object.keys(output.modules)) {
          const root = packageRoot(moduleId);
          if (root) roots.add(root);
        }
      }
    },
    closeBundle() {
      const packages = [...roots].map((root) => {
        const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        const licenseFiles = [];
        for (const name of [
          'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING', 'NOTICE',
        ]) {
          const path = join(root, name);
          if (!LICENSE_FILE.test(name) || !existsSync(path)) continue;
          const text = readFileSync(path, 'utf8').trim();
          if (text) licenseFiles.push({ name, text });
        }
        return {
          name: manifest.name,
          version: manifest.version,
          license: manifest.license ?? null,
          repository: repositoryUrl(manifest.repository),
          homepage: manifest.homepage ?? null,
          licenseFiles,
        };
      }).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

      const output = resolve('.compliance/frontend-packages.json');
      mkdirSync(dirname(output), { recursive: true });
      const payload = { schemaVersion: 1, packages };
      const serialized = `${JSON.stringify(payload, null, 2)}\n`;
      payload.sha256 = createHash('sha256').update(serialized).digest('hex');
      writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
    },
  };
}
