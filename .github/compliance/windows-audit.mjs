#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const windowsTarget = 'x86_64-pc-windows-msvc';
const expectedTauriCliVersion = '2.12.4';
const expectedNsisVersion = '3.13';
const expectedNsisUtilsVersion = '0.5.3';
const forbiddenLicense = /(?:AGPL|SSPL|BUSL|Commons-Clause|UNLICENSED|SEE LICENSE|proprietary|non[- ]free)/i;
const allowedJavascriptLicense = /^(?:(?:MIT|ISC|0BSD|BSD-[234]-Clause|Apache-2\.0|MPL-2\.0|CC0-1\.0|Unlicense|BlueOak-1\.0\.0)(?:\s+(?:OR|AND)\s+)?)+$/;

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '').replaceAll('-', '_');
    if (!key || argv[index + 1] === undefined) {
      throw new Error(`Argumento inválido: ${argv[index] ?? ''}`);
    }
    result[key] = resolve(argv[index + 1]);
  }
  return result;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function write(outputDirectory, name, contents) {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, name), contents.endsWith('\n') ? contents : `${contents}\n`);
}

function cargoPackages() {
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata', '--manifest-path', join(root, 'src-tauri/Cargo.toml'),
    '--format-version', '1', '--locked', '--filter-platform', windowsTarget,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const packageById = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodeById = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const included = new Set();
  function visit(id) {
    if (included.has(id)) return;
    included.add(id);
    for (const dependency of nodeById.get(id)?.deps ?? []) {
      if (dependency.dep_kinds.some((kind) => kind.kind === null)) visit(dependency.pkg);
    }
  }
  visit(metadata.resolve.root);
  return [...included]
    .filter((id) => id !== metadata.resolve.root)
    .map((id) => packageById.get(id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function frontendPackages(frontendInventory) {
  const document = JSON.parse(readFileSync(frontendInventory, 'utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.packages)) {
    throw new Error(`Inventário frontend inválido: ${frontendInventory}`);
  }
  for (const pkg of document.packages) {
    if (!pkg.name || !pkg.version || !pkg.license || !Array.isArray(pkg.licenseFiles)) {
      throw new Error(`Metadados frontend incompletos: ${pkg.name ?? '(sem nome)'}`);
    }
    if (forbiddenLicense.test(pkg.license) || !allowedJavascriptLicense.test(pkg.license)) {
      throw new Error(`Licença JavaScript não aprovada: ${pkg.name} ${pkg.version} (${pkg.license})`);
    }
  }
  return document.packages;
}

function normalizeCargoLicense(value, pkg) {
  if (!value) throw new Error(`Crate sem licença declarada: ${pkg.name} ${pkg.version}`);
  const normalized = value.replace(/\s*\/\s*/g, ' OR ').replace(/\s+/g, ' ').trim();
  if (forbiddenLicense.test(normalized)) {
    throw new Error(`Licença Cargo não aprovada: ${pkg.name} ${pkg.version} (${normalized})`);
  }
  return normalized;
}

function spdxId(kind, name, version = '') {
  return `SPDXRef-${kind}-${sha256(`${name}\0${version}`).slice(0, 20)}`;
}

function packageReference(type, namespace, name, version) {
  const encodedName = name.split('/').map(encodeURIComponent).join('/');
  return {
    referenceCategory: 'PACKAGE-MANAGER',
    referenceType: 'purl',
    referenceLocator: `pkg:${type}/${namespace ? `${namespace}/` : ''}${encodedName}@${encodeURIComponent(version)}`,
  };
}

function renderNotices(rustNotices, frontend, packagingNotices) {
  let result = '# Third-party notices / Avisos de terceiros\n\n';
  result += 'Generated for the Windows x64 NSIS distribution. Development-only tools are excluded.\n\n';
  result += 'Gerado para a distribuição NSIS Windows x64. Ferramentas exclusivas de desenvolvimento não são listadas.\n\n';
  result += `${rustNotices.trim()}\n\n`;
  result += '## JavaScript packages included in the frontend bundle\n\n';
  result += '| Package | Version | License |\n|---|---:|---|\n';
  for (const pkg of frontend) result += `| ${pkg.name} | ${pkg.version} | ${pkg.license} |\n`;
  for (const pkg of frontend) {
    for (const license of pkg.licenseFiles) {
      result += `\n---\n\n### ${pkg.name} ${pkg.version} — ${license.name}\n\n\`\`\`text\n${license.text.trim()}\n\`\`\`\n`;
    }
  }
  result += '\n## Windows packaging components\n\n';
  result += `- NSIS ${expectedNsisVersion}, including its LZMA compression module.\n`;
  result += `- nsis-tauri-utils ${expectedNsisUtilsVersion}.\n`;
  for (const notice of packagingNotices) {
    result += `\n---\n\n### ${notice.title}\n\n\`\`\`text\n${notice.text.trim()}\n\`\`\`\n`;
  }
  return result;
}

function renderSourceOffer(version, cargo, frontend) {
  const copyleftCargo = cargo.filter((pkg) => /(?:AGPL|GPL|LGPL|MPL)/i.test(pkg.license ?? ''));
  const copyleftFrontend = frontend.filter((pkg) => /(?:AGPL|GPL|LGPL|MPL)/i.test(pkg.license));
  return `# Corresponding source / Código-fonte correspondente\n\n` +
    `This document covers ZYYK Verse ${version} for Windows x64. The Verse source and build files are available in the GitHub source archives for the release tag. Copyleft dependency sources are preserved in \`ZYYK-Verse-${version}-third-party-copyleft-sources.tar.gz\` attached to the same release.\n\n` +
    `Este documento corresponde ao ZYYK Verse ${version} para Windows x64. O código do Verse e seus arquivos de build estão nos arquivos de código-fonte da tag. As fontes das dependências copyleft são preservadas em \`ZYYK-Verse-${version}-third-party-copyleft-sources.tar.gz\` anexado à mesma release.\n\n` +
    `## Rust crates\n\n${copyleftCargo.length ? copyleftCargo.map((pkg) => `- ${pkg.name} ${pkg.version} (${normalizeCargoLicense(pkg.license, pkg)})`).join('\n') : 'No copyleft Rust runtime crate was detected. / Nenhuma crate copyleft de execução foi detectada.'}\n\n` +
    `## JavaScript packages\n\n${copyleftFrontend.length ? copyleftFrontend.map((pkg) => `- ${pkg.name} ${pkg.version} (${pkg.license})`).join('\n') : 'No copyleft JavaScript runtime package was detected. / Nenhum pacote JavaScript copyleft de execução foi detectado.'}\n\n` +
    `## NSIS packaging\n\nNSIS ${expectedNsisVersion} source: https://github.com/NSIS-Dev/nsis/tree/v313\n\n` +
    `nsis-tauri-utils ${expectedNsisUtilsVersion} source: https://github.com/tauri-apps/nsis-tauri-utils/tree/nsis_tauri_utils-v0.5.3\n`;
}

function createSbom(version, installer, cargo, frontend, nsisNotice) {
  const rootId = 'SPDXRef-Package-ZYYK-Verse-Windows-x86-64';
  const packages = [{
    name: 'ZYYK Verse Windows x64 NSIS installer',
    SPDXID: rootId,
    versionInfo: version,
    supplier: 'Person: Alisson Lima',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    checksums: [{ algorithm: 'SHA256', checksumValue: sha256File(installer) }],
    licenseConcluded: 'GPL-3.0-or-later',
    licenseDeclared: 'GPL-3.0-or-later',
    copyrightText: 'Copyright (C) 2026 Alisson Lima',
    primaryPackagePurpose: 'APPLICATION',
  }];
  for (const pkg of cargo) packages.push({
    name: pkg.name,
    SPDXID: spdxId('Cargo', pkg.name, pkg.version),
    versionInfo: pkg.version,
    supplier: 'NOASSERTION',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: normalizeCargoLicense(pkg.license, pkg),
    licenseDeclared: normalizeCargoLicense(pkg.license, pkg),
    copyrightText: 'NOASSERTION',
    primaryPackagePurpose: 'LIBRARY',
    externalRefs: [packageReference('cargo', '', pkg.name, pkg.version)],
  });
  for (const pkg of frontend) {
    const scoped = pkg.name.startsWith('@') ? pkg.name.slice(1).split('/') : [];
    packages.push({
      name: pkg.name,
      SPDXID: spdxId('Npm', pkg.name, pkg.version),
      versionInfo: pkg.version,
      supplier: 'NOASSERTION',
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: pkg.license,
      licenseDeclared: pkg.license,
      copyrightText: 'NOASSERTION',
      primaryPackagePurpose: 'LIBRARY',
      externalRefs: [packageReference('npm', scoped.length === 2 ? scoped[0] : '', scoped.length === 2 ? scoped[1] : pkg.name, pkg.version)],
    });
  }
  packages.push({
    name: 'NSIS', SPDXID: spdxId('Packaging', 'NSIS', expectedNsisVersion), versionInfo: expectedNsisVersion,
    supplier: 'Organization: NSIS contributors', downloadLocation: 'https://github.com/NSIS-Dev/nsis/tree/v313',
    filesAnalyzed: false, licenseConcluded: 'LicenseRef-NSIS-3.13', licenseDeclared: 'LicenseRef-NSIS-3.13',
    copyrightText: 'Copyright (C) 1999-2026 Contributors', primaryPackagePurpose: 'LIBRARY',
  }, {
    name: 'nsis-tauri-utils', SPDXID: spdxId('Packaging', 'nsis-tauri-utils', expectedNsisUtilsVersion), versionInfo: expectedNsisUtilsVersion,
    supplier: 'Organization: Tauri Programme within The Commons Conservancy',
    downloadLocation: 'https://github.com/tauri-apps/nsis-tauri-utils/tree/nsis_tauri_utils-v0.5.3',
    filesAnalyzed: false, licenseConcluded: 'MIT OR Apache-2.0', licenseDeclared: 'MIT OR Apache-2.0',
    copyrightText: 'Copyright (c) 2019-2022 Tauri Programme within The Commons Conservancy', primaryPackagePurpose: 'LIBRARY',
  });
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `ZYYK-Verse-${version}-windows-x86_64`,
    documentNamespace: `https://github.com/alissonlima086/zyyk-verse/releases/tag/v${version}/windows-x86_64`,
    creationInfo: { created: new Date().toISOString(), creators: ['Tool: zyyk-windows-audit'] },
    documentDescribes: [rootId],
    packages,
    relationships: packages.slice(1).map((pkg) => ({
      spdxElementId: rootId, relatedSpdxElement: pkg.SPDXID, relationshipType: 'CONTAINS',
    })),
    hasExtractedLicensingInfos: [{
      licenseId: 'LicenseRef-NSIS-3.13',
      name: `NSIS ${expectedNsisVersion} combined licensing terms`,
      extractedText: nsisNotice,
      seeAlsos: ['https://github.com/NSIS-Dev/nsis/blob/v313/COPYING'],
    }],
  };
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  for (const key of ['installer', 'frontend_inventory', 'rust_notices', 'nsis_notice', 'utils_mit_notice', 'utils_apache_notice', 'output_dir']) {
    if (!args[key] || (key !== 'output_dir' && !existsSync(args[key]))) {
      throw new Error(`Argumento obrigatório ausente ou inválido: --${key.replaceAll('_', '-')}`);
    }
  }
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const installerName = basename(args.installer);
  if (installerName !== `ZYYK Verse_${version}_x64-setup.exe` || statSync(args.installer).size === 0) {
    throw new Error(`Instalador NSIS inválido para a versão ${version}: ${args.installer}`);
  }
  const tauriCliVersion = JSON.parse(readFileSync(join(root, 'node_modules/@tauri-apps/cli/package.json'), 'utf8')).version;
  if (tauriCliVersion !== expectedTauriCliVersion) {
    throw new Error(`@tauri-apps/cli ${tauriCliVersion} ainda não tem componentes NSIS auditados; esperado ${expectedTauriCliVersion}.`);
  }
  const cargo = cargoPackages();
  const frontend = frontendPackages(args.frontend_inventory);
  const nsisNotice = readFileSync(args.nsis_notice, 'utf8');
  const packagingNotices = [
    { title: `NSIS ${expectedNsisVersion}`, text: nsisNotice },
    { title: `nsis-tauri-utils ${expectedNsisUtilsVersion} — MIT`, text: readFileSync(args.utils_mit_notice, 'utf8') },
    { title: `nsis-tauri-utils ${expectedNsisUtilsVersion} — Apache-2.0`, text: readFileSync(args.utils_apache_notice, 'utf8') },
  ];
  write(args.output_dir, 'THIRD_PARTY_NOTICES.md', renderNotices(readFileSync(args.rust_notices, 'utf8'), frontend, packagingNotices));
  write(args.output_dir, 'SOURCE_OFFER.md', renderSourceOffer(version, cargo, frontend));
  write(args.output_dir, 'SBOM.spdx.json', JSON.stringify(createSbom(version, args.installer, cargo, frontend, nsisNotice), null, 2));
  write(args.output_dir, 'AUDIT_REPORT.md', `# Windows x64 compliance audit / Auditoria de compliance Windows x64\n\n` +
    `Status: approved for unsigned NSIS packaging. This technical check is not legal advice.\n\n` +
    `Status: aprovado para empacotamento NSIS sem assinatura. Esta verificação técnica não substitui aconselhamento jurídico.\n\n` +
    `- ${cargo.length} Windows runtime Rust crates inventoried.\n` +
    `- ${frontend.length} JavaScript runtime packages inventoried from the final frontend bundle.\n` +
    `- Tauri CLI ${expectedTauriCliVersion}, NSIS ${expectedNsisVersion}, and nsis-tauri-utils ${expectedNsisUtilsVersion} are pinned by the locked build and notice policy.\n` +
    `- Installer SHA-256 recorded in the SPDX SBOM.\n` +
    `- The installer is intentionally unsigned and may trigger Microsoft Defender SmartScreen.\n`);
  write(args.output_dir, 'copyleft-native-sources.tsv', '');
  write(args.output_dir, 'native-sources.tsv', '');
  write(args.output_dir, 'copyleft-cargo-sources.tsv', cargo
    .filter((pkg) => /(?:AGPL|GPL|LGPL|MPL)/i.test(pkg.license ?? ''))
    .map((pkg) => `${pkg.name}\t${pkg.version}\t${dirname(pkg.manifest_path)}\t${normalizeCargoLicense(pkg.license, pkg)}`)
    .sort().join('\n'));
  write(args.output_dir, 'copyleft-frontend-sources.tsv', frontend
    .filter((pkg) => /(?:AGPL|GPL|LGPL|MPL)/i.test(pkg.license))
    .map((pkg) => `${pkg.name}\t${pkg.version}\t${pkg.license}`)
    .sort().join('\n'));
  console.log(`Windows compliance generated: ${cargo.length} Rust crates, ${frontend.length} frontend packages.`);
}

main();
