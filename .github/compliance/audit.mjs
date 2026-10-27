import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const outputDirectory = join(root, '.compliance');
const forbiddenLicense = /(?:AGPL|SSPL|BUSL|Commons-Clause|UNLICENSED|SEE LICENSE|proprietary|non[- ]free)/i;
const allowedJavascriptLicense = /^(?:(?:MIT|ISC|0BSD|BSD-[234]-Clause|Apache-2\.0|MPL-2\.0|CC0-1\.0|Unlicense|BlueOak-1\.0\.0)(?:\s+(?:OR|AND)\s+)?)+$/;

function parseArguments(argv) {
  const result = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '').replaceAll('-', '_');
    if (!key || argv[index + 1] === undefined) throw new Error(`Argumento inválido: ${argv[index] ?? ''}`);
    result[key] = resolve(argv[index + 1]);
  }
  return result;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function write(name, contents) {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, name), contents.endsWith('\n') ? contents : `${contents}\n`);
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(path));
    else result.push(path);
  }
  return result;
}

function cargoPackages() {
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata', '--manifest-path', join(root, 'src-tauri/Cargo.toml'),
    '--format-version', '1', '--locked', '--filter-platform', 'x86_64-unknown-linux-gnu',
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

function frontendPackages() {
  const path = join(outputDirectory, 'frontend-packages.json');
  if (!existsSync(path)) throw new Error('Inventário do bundle frontend ausente. Execute npm run build.');
  const packages = JSON.parse(readFileSync(path, 'utf8')).packages;
  for (const pkg of packages) {
    if (!pkg.name || !pkg.version || !pkg.license) {
      throw new Error(`Metadados de licença incompletos no bundle frontend: ${pkg.name ?? '(sem nome)'}`);
    }
    if (forbiddenLicense.test(pkg.license) || !allowedJavascriptLicense.test(pkg.license)) {
      throw new Error(`Licença JavaScript não aprovada ou desconhecida: ${pkg.name} ${pkg.version} (${pkg.license})`);
    }
  }
  return packages;
}

function queryNativePackage(documentPath) {
  const marker = documentPath.indexOf('/usr/share/doc/');
  const relativeDocument = marker >= 0 ? documentPath.slice(marker) : documentPath;
  let binaryPackage = basename(dirname(documentPath));
  try {
    const owner = execFileSync('dpkg-query', ['-S', relativeDocument], { encoding: 'utf8' }).split(': ')[0].trim();
    if (owner) binaryPackage = owner;
  } catch {
    // linuxdeploy preserves /usr/share/doc/<binary-package>/copyright, which is
    // also a valid dpkg-query key when path ownership lookup is unavailable.
  }
  try {
    const value = execFileSync('dpkg-query', [
      '-W', '-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n', binaryPackage,
    ], { encoding: 'utf8' }).trim();
    const [name, version, sourceName, sourceVersion] = value.split('\t');
    if (!name || !version) throw new Error('campos vazios');
    return { name, version, sourceName: sourceName || name.replace(/:.*$/, ''), sourceVersion: sourceVersion || version };
  } catch {
    throw new Error(`Não foi possível vincular o aviso nativo a um pacote instalado: ${documentPath}`);
  }
}

function nativePackages(appdir) {
  const docRoot = join(appdir, 'usr/share/doc');
  const copyrightFiles = walk(docRoot).filter((path) => basename(path) === 'copyright' && !path.includes('/zyyk-verse/'));
  if (!copyrightFiles.length) throw new Error('O AppImage não contém avisos copyright das bibliotecas nativas.');

  const packages = copyrightFiles.map((path) => {
    const text = readFileSync(path, 'utf8').trim();
    if (!text) throw new Error(`Aviso copyright vazio: ${path}`);
    const metadata = queryNativePackage(path);
    // `\s` também casa quebras de linha. Restrinja o campo à mesma linha para
    // não interpretar o primeiro parágrafo da licença como seu identificador.
    const licenses = [...new Set([...text.matchAll(/^License:[\t ]*([^\r\n]+)$/gmi)]
      .map((match) => match[1].trim()).filter(Boolean))];
    if (forbiddenLicense.test(licenses.join(' '))) {
      throw new Error(`Licença nativa requer revisão explícita: ${metadata.name} (${licenses.join(', ')})`);
    }
    return { ...metadata, licenses, text, noticePath: relative(appdir, path) };
  });
  return packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function expectedPlugins(pluginPolicy) {
  if (!pluginPolicy || !existsSync(pluginPolicy)) throw new Error('Política de plugins GStreamer ausente.');
  return readFileSync(pluginPolicy, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    const [name, version, license, origin, reportedLicense = license] = line.split('\t');
    if (!name || !version || !license || !origin || forbiddenLicense.test(license)) throw new Error(`Registro GStreamer inválido: ${line}`);
    return { name, version, license, origin, reportedLicense };
  });
}

function actualPlugins(appdir) {
  return walk(join(appdir, 'usr/lib/gstreamer-1.0'))
    .filter((path) => /^libgst.*\.so$/.test(basename(path)))
    .map((path) => basename(path)).sort();
}

function verifyPlugins(appdir, policy) {
  const expected = expectedPlugins(policy).map((plugin) => plugin.name).sort();
  const actual = actualPlugins(appdir);
  const missing = expected.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.includes(name));
  if (missing.length || unexpected.length) {
    throw new Error(`Conjunto GStreamer divergente. Ausentes: ${missing.join(', ') || 'nenhum'}. Não aprovados: ${unexpected.join(', ') || 'nenhum'}.`);
  }
  return expectedPlugins(policy);
}

function spdxPackages(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  if (!document.spdxVersion?.startsWith('SPDX-2.') || !Array.isArray(document.packages)) {
    throw new Error(`SBOM SPDX inválido: ${path}`);
  }
  return new Set(document.packages.map((pkg) => {
    const purl = pkg.externalRefs?.find((entry) => entry.referenceType === 'purl')?.referenceLocator ?? '';
    return `${pkg.name}\t${pkg.versionInfo ?? ''}\t${purl}`;
  }));
}

function componentFingerprint(appdir, sbomPath) {
  const nativeObjects = walk(join(appdir, 'usr/lib'))
    .filter((path) => /\.so(?:\.|$)/.test(basename(path)))
    .map((path) => relative(appdir, path)).sort();
  return {
    nativeObjects,
    plugins: actualPlugins(appdir),
    sbomPackages: [...spdxPackages(sbomPath)].sort(),
  };
}

function renderNotices(rust, frontend, native, plugins) {
  const uniqueTexts = new Map();
  function addText(owner, name, text) {
    const key = sha256(text.trim());
    const item = uniqueTexts.get(key) ?? { owners: [], text: text.trim() };
    item.owners.push(`${owner} (${name})`);
    uniqueTexts.set(key, item);
  }
  for (const pkg of frontend) for (const file of pkg.licenseFiles) addText(`${pkg.name} ${pkg.version}`, file.name, file.text);
  for (const pkg of native) addText(`${pkg.name} ${pkg.version}`, pkg.noticePath, pkg.text);

  let result = `# Avisos de terceiros\n\n`;
  result += `Este documento foi gerado a partir dos componentes encontrados no AppImage. Ferramentas exclusivamente de desenvolvimento não são listadas. Textos idênticos são centralizados sem remover a identificação dos componentes.\n\n`;
  result += `${rust.trim()}\n\n## Dependências JavaScript presentes no bundle final\n\n| Componente | Versão | Licença | Origem |\n|---|---:|---|---|\n`;
  for (const pkg of frontend) result += `| ${pkg.name} | ${pkg.version} | ${pkg.license} | ${pkg.repository ?? pkg.homepage ?? 'npm registry'} |\n`;
  result += `\n## Bibliotecas nativas presentes no AppImage\n\n| Pacote binário | Versão | Pacote-fonte | Licenças declaradas no aviso |\n|---|---:|---|---|\n`;
  for (const pkg of native) result += `| ${pkg.name} | ${pkg.version} | ${pkg.sourceName} ${pkg.sourceVersion} | ${pkg.licenses.join(', ') || 'consulte o texto integral abaixo'} |\n`;
  result += `\n## Plugins GStreamer aprovados\n\n| Plugin | Versão | Licença declarada | Origem |\n|---|---:|---|---|\n`;
  for (const plugin of plugins) result += `| ${plugin.name} | ${plugin.version} | ${plugin.license} | ${plugin.origin} |\n`;
  result += `\n## Textos e avisos preservados\n`;
  for (const item of [...uniqueTexts.values()].sort((a, b) => a.owners[0].localeCompare(b.owners[0]))) {
    result += `\n---\n\n### ${item.owners.sort().join('; ')}\n\n\`\`\`text\n${item.text}\n\`\`\`\n`;
  }
  return result;
}

function renderSourceOffer(frontend, native, cargo) {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const copyleftFrontend = frontend.filter((pkg) => /(?:MPL|GPL|LGPL)/i.test(pkg.license));
  const sources = new Map(native.map((pkg) => [`${pkg.sourceName}\t${pkg.sourceVersion}`, pkg]));
  return `# Código-fonte correspondente\n\n` +
    `Este documento corresponde ao ZYYK Verse ${version}. O código-fonte do Verse, os arquivos de build e as configurações usados na release são distribuídos no arquivo \`ZYYK-Verse-${version}-source.tar.gz\` anexado à mesma release.\n\n` +
    `As fontes exatas dos componentes copyleft incorporados são preservadas em \`ZYYK-Verse-${version}-copyleft-sources.tar.gz\`, também anexado à release. O arquivo contém um manifesto e checksums SHA-256 próprios.\n\n` +
    `## Crates Rust incorporadas\n\nAs fontes exatas podem ser obtidas pelo Cargo a partir do \`src-tauri/Cargo.lock\` incluído no arquivo-fonte. Componentes: ${cargo.map((pkg) => `${pkg.name} ${pkg.version}`).join(', ')}.\n\n` +
    `## Código JavaScript copyleft\n\n${copyleftFrontend.length ? copyleftFrontend.map((pkg) => `- ${pkg.name} ${pkg.version} (${pkg.license}): \`npm pack ${pkg.name}@${pkg.version}\`.`).join('\n') : 'Nenhum componente JavaScript copyleft foi identificado no bundle.'}\n\n` +
    `## Bibliotecas nativas\n\nAs bibliotecas compartilhadas permanecem separadas dentro do AppImage. Os pacotes-fonte exatos usados pelo ambiente Ubuntu 22.04 são:\n\n` +
    `| Pacote-fonte | Versão | Obtenção reproduzível |\n|---|---:|---|\n` +
    [...sources.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName)).map((pkg) =>
      `| ${pkg.sourceName} | ${pkg.sourceVersion} | \`apt-get source ${pkg.sourceName}=${pkg.sourceVersion}\` |`).join('\n') +
    `\n\nAs versões acima são verificadas no pipeline contra os metadados dos repositórios Ubuntu usados no build. Os pacotes copyleft são baixados durante a mesma execução e preservados no arquivo de fontes correspondente, sem depender apenas da disponibilidade futura do repositório upstream.\n`;
}

function bootstrap() {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const preliminary = 'Documento transitório da primeira passagem; não publicar.';
  write('THIRD_PARTY_NOTICES.md', `# Avisos de terceiros\n\n${preliminary}\n`);
  write('SOURCE_OFFER.md', `# Código-fonte correspondente\n\n${preliminary}\n`);
  write('AUDIT_REPORT.md', `# Relatório de auditoria\n\n${preliminary}\n`);
  write('SBOM.spdx.json', `${JSON.stringify({
    spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT',
    name: `ZYYK-Verse-${version}-bootstrap`, documentNamespace: `https://github.com/zyyk/verse/bootstrap/${version}`,
    creationInfo: { created: new Date(0).toISOString(), creators: ['Tool: zyyk-compliance-bootstrap'] },
    packages: [], relationships: [],
  }, null, 2)}\n`);
}

function spdxId(kind, name, version = '') {
  return `SPDXRef-${kind}-${sha256(`${name}\0${version}`).slice(0, 20)}`;
}

function normalizeCargoLicense(value) {
  if (!value) throw new Error('Crate de execução sem licença declarada.');
  // O formato `MIT/Apache-2.0` era usado pelo ecossistema Cargo antes de
  // expressões SPDX; semanticamente ele representa uma escolha (`OR`).
  return value.replace(/\s*\/\s*/g, ' OR ').replace(/\s+/g, ' ').trim();
}

function gstreamerLicense(value) {
  const normalized = value.trim();
  if (normalized === 'LGPL') return 'LGPL-2.1-or-later';
  if (normalized === 'LGPL-2.1-or-later' || normalized === 'MIT' || normalized === 'Apache-2.0') return normalized;
  throw new Error(`Licença GStreamer sem mapeamento SPDX explícito: ${value}`);
}

function nativeLicenseReference(pkg, extractedLicenses) {
  const declaration = pkg.licenses.length
    ? pkg.licenses.join('; ')
    : 'consulte o arquivo copyright integral';
  const licenseId = `LicenseRef-Debian-${sha256(`${pkg.sourceName}\0${pkg.sourceVersion}\0${pkg.text}`).slice(0, 24)}`;
  if (!extractedLicenses.some((entry) => entry.licenseId === licenseId)) {
    extractedLicenses.push({
      licenseId,
      name: `Declaração Debian de ${pkg.sourceName} ${pkg.sourceVersion}: ${declaration}`,
      extractedText: pkg.text,
    });
  }
  return licenseId;
}

function validateSpdxLicenses(document, path) {
  const extracted = new Set((document.hasExtractedLicensingInfos ?? []).map((item) => item.licenseId));
  for (const pkg of document.packages ?? []) {
    for (const field of ['licenseDeclared', 'licenseConcluded']) {
      const expression = pkg[field];
      if (!expression || expression === 'NOASSERTION' || expression === 'NONE') {
        throw new Error(`Licença ${field} não determinada no SBOM: ${pkg.name} ${pkg.versionInfo ?? ''} (${path})`);
      }
      if (/[+/]/.test(expression)) {
        throw new Error(`Expressão SPDX legada ou inválida em ${pkg.name}: ${expression}`);
      }
      const licenseRefs = expression.match(/LicenseRef-[A-Za-z0-9.-]+/g) ?? [];
      for (const licenseRef of licenseRefs) {
        if (!extracted.has(licenseRef)) throw new Error(`LicenseRef sem texto extraído: ${licenseRef}`);
      }
      const remainder = expression
        .replace(/LicenseRef-[A-Za-z0-9.-]+/g, '')
        .replace(/[A-Za-z0-9][A-Za-z0-9.-]*/g, '')
        .replace(/[()\s]/g, '');
      if (remainder) throw new Error(`Expressão SPDX inválida em ${pkg.name}: ${expression}`);
    }
  }
}

function packageReference(type, namespace, name, version) {
  const encodedName = name.split('/').map(encodeURIComponent).join('/');
  return {
    referenceCategory: 'PACKAGE-MANAGER',
    referenceType: 'purl',
    referenceLocator: `pkg:${type}/${namespace ? `${namespace}/` : ''}${encodedName}@${encodeURIComponent(version)}`,
  };
}

function enrichSpdx(path, cargo, frontend, native, plugins) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  const rootPackage = document.packages.find((pkg) => pkg.primaryPackagePurpose === 'FILE') ?? document.packages[0];
  if (!rootPackage) throw new Error('O SBOM base não contém o pacote-raiz do AppImage.');
  const additions = [];
  const extractedLicenses = document.hasExtractedLicensingInfos ?? [];
  rootPackage.supplier = 'Person: Alisson Lima';
  rootPackage.licenseDeclared = 'GPL-3.0-or-later';
  rootPackage.licenseConcluded = 'GPL-3.0-or-later';
  rootPackage.copyrightText = 'Copyright (C) 2026 Alisson Lima';

  for (const pkg of cargo) additions.push({
    name: pkg.name,
    SPDXID: spdxId('Cargo', pkg.name, pkg.version),
    versionInfo: pkg.version,
    supplier: 'NOASSERTION', downloadLocation: 'NOASSERTION', filesAnalyzed: false,
    licenseConcluded: normalizeCargoLicense(pkg.license), licenseDeclared: normalizeCargoLicense(pkg.license), copyrightText: 'NOASSERTION',
    primaryPackagePurpose: 'LIBRARY',
    externalRefs: [packageReference('cargo', '', pkg.name, pkg.version)],
    ...(pkg.repository || pkg.homepage ? { homepage: pkg.repository || pkg.homepage } : {}),
  });
  for (const pkg of frontend) {
    const scoped = pkg.name.startsWith('@') ? pkg.name.slice(1).split('/') : [];
    const namespace = scoped.length === 2 ? encodeURIComponent(scoped[0]) : '';
    const name = scoped.length === 2 ? scoped[1] : pkg.name;
    additions.push({
      name: pkg.name, SPDXID: spdxId('Npm', pkg.name, pkg.version), versionInfo: pkg.version,
      supplier: 'NOASSERTION', downloadLocation: 'NOASSERTION', filesAnalyzed: false,
      licenseConcluded: pkg.license, licenseDeclared: pkg.license, copyrightText: 'NOASSERTION',
      primaryPackagePurpose: 'LIBRARY', externalRefs: [packageReference('npm', namespace, name, pkg.version)],
      ...(pkg.repository || pkg.homepage ? { homepage: pkg.repository || pkg.homepage } : {}),
    });
  }
  for (const pkg of native) {
    const license = nativeLicenseReference(pkg, extractedLicenses);
    additions.push({
      name: pkg.name, SPDXID: spdxId('Deb', pkg.name, pkg.version), versionInfo: pkg.version,
      supplier: 'Organization: Ubuntu', downloadLocation: 'NOASSERTION', filesAnalyzed: false,
      licenseConcluded: license, licenseDeclared: license, copyrightText: 'NOASSERTION',
      primaryPackagePurpose: 'LIBRARY',
      comment: `Pacote-fonte: ${pkg.sourceName} ${pkg.sourceVersion}. Licenças no aviso: ${pkg.licenses.join(', ') || 'consulte THIRD_PARTY_NOTICES.md'}.`,
      externalRefs: [packageReference('deb', 'ubuntu', pkg.name.replace(/:.*$/, ''), pkg.version)],
    });
  }
  for (const plugin of plugins) {
    const license = gstreamerLicense(plugin.license);
    additions.push({
      name: plugin.name, SPDXID: spdxId('GStreamer', plugin.name, plugin.version), versionInfo: plugin.version,
      supplier: 'Organization: GStreamer project', downloadLocation: plugin.origin, filesAnalyzed: false,
      licenseConcluded: license, licenseDeclared: license, copyrightText: 'NOASSERTION',
      primaryPackagePurpose: 'LIBRARY',
      comment: `Plugin GStreamer; gst-inspect-1.0 declarou ${plugin.reportedLicense}; política normalizada para ${license}.`,
    });
  }

  document.packages.push(...additions);
  document.relationships ??= [];
  document.relationships.push(...additions.map((pkg) => ({
    spdxElementId: rootPackage.SPDXID, relatedSpdxElement: pkg.SPDXID, relationshipType: 'CONTAINS',
  })));
  document.hasExtractedLicensingInfos = extractedLicenses;
  document.creationInfo.comment = 'Inventário Syft enriquecido com os grafos reais de execução Cargo/Vite e metadados dpkg/gst-inspect do AppImage.';
  validateSpdxLicenses(document, path);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

function generate(args) {
  if (!args.appdir || !args.sbom || !args.plugin_policy || !args.rust_notices) {
    throw new Error('generate requer --appdir, --sbom, --plugin-policy e --rust-notices.');
  }
  const frontend = frontendPackages();
  const cargo = cargoPackages();
  const native = nativePackages(args.appdir);
  const plugins = verifyPlugins(args.appdir, args.plugin_policy);
  const rust = readFileSync(args.rust_notices, 'utf8');
  spdxPackages(args.sbom);
  const fingerprint = componentFingerprint(args.appdir, args.sbom);
  enrichSpdx(args.sbom, cargo, frontend, native, plugins);
  write('THIRD_PARTY_NOTICES.md', renderNotices(rust, frontend, native, plugins));
  write('SOURCE_OFFER.md', renderSourceOffer(frontend, native, cargo));
  const nativeSources = [...new Map(native.map((pkg) => [
    `${pkg.sourceName}\t${pkg.sourceVersion}`, `${pkg.sourceName}\t${pkg.sourceVersion}`,
  ])).values()].sort().join('\n');
  write('native-sources.tsv', nativeSources);
  const copyleftNativeSources = [...new Map(native
    .filter((pkg) => /(?:\bAGPL\b|\bGPL\b|\bLGPL\b|\bMPL\b|General Public License)/i.test(`${pkg.licenses.join(' ')}\n${pkg.text}`))
    .map((pkg) => [`${pkg.sourceName}\t${pkg.sourceVersion}`, `${pkg.sourceName}\t${pkg.sourceVersion}`]))
    .values()].sort().join('\n');
  write('copyleft-native-sources.tsv', copyleftNativeSources);
  write('copyleft-cargo-sources.tsv', cargo
    .filter((pkg) => /(?:AGPL|GPL|LGPL|MPL)/i.test(pkg.license ?? ''))
    .map((pkg) => `${pkg.name}\t${pkg.version}\t${dirname(pkg.manifest_path)}\t${normalizeCargoLicense(pkg.license)}`)
    .sort().join('\n'));
  write('copyleft-frontend-sources.tsv', frontend
    .filter((pkg) => /(?:AGPL|GPL|LGPL|MPL)/i.test(pkg.license))
    .map((pkg) => `${pkg.name}\t${pkg.version}\t${pkg.license}`)
    .sort().join('\n'));
  writeFileSync(join(outputDirectory, 'SBOM.spdx.json'), readFileSync(args.sbom));
  write('component-fingerprint.json', JSON.stringify(fingerprint, null, 2));
  write('AUDIT_REPORT.md', `# Relatório de auditoria de licenças\n\n` +
    `Status: aprovado para empacotamento automatizado. Esta verificação técnica não substitui aconselhamento jurídico.\n\n` +
    `- ${cargo.length} crates Rust de execução analisadas por cargo-about.\n` +
    `- ${frontend.length} pacotes JavaScript encontrados no bundle final.\n` +
    `- ${native.length} pacotes nativos com avisos preservados.\n` +
    `- ${plugins.length} plugins GStreamer na lista mínima aprovada.\n` +
    `- Nenhuma licença ausente, proibida pela política ou plugin não aprovado foi detectado.\n`);
}

function validate(args) {
  if (!args.appdir || !args.sbom || !args.plugin_policy) {
    throw new Error('validate requer --appdir, --sbom e --plugin-policy.');
  }
  verifyPlugins(args.appdir, args.plugin_policy);
  const expected = JSON.parse(readFileSync(join(outputDirectory, 'component-fingerprint.json'), 'utf8'));
  const actual = componentFingerprint(args.appdir, args.sbom);
  const differences = [];
  for (const key of ['nativeObjects', 'plugins', 'sbomPackages']) {
    const before = new Set(expected[key]);
    const after = new Set(actual[key]);
    const removed = [...before].filter((item) => !after.has(item));
    const added = [...after].filter((item) => !before.has(item));
    if (removed.length || added.length) {
      differences.push(`${key}: removidos [${removed.join(', ')}]; adicionados [${added.join(', ')}]`);
    }
  }
  if (differences.length) {
    throw new Error(`O inventário do AppImage final diverge da primeira passagem auditada. ${differences.join(' | ')}`);
  }
  const docRoot = join(args.appdir, 'usr/share/doc/zyyk-verse');
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'SOURCE_OFFER.md', 'SBOM.spdx.json', 'AUDIT_REPORT.md']) {
    const path = join(docRoot, name);
    if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Documento ausente no AppImage final: ${name}`);
    if (name !== 'LICENSE' && readFileSync(path, 'utf8').includes('Documento transitório')) {
      throw new Error(`Documento transitório presente no AppImage final: ${name}`);
    }
  }
  const embeddedSpdxPath = join(docRoot, 'SBOM.spdx.json');
  validateSpdxLicenses(JSON.parse(readFileSync(embeddedSpdxPath, 'utf8')), embeddedSpdxPath);
  console.log('AppImage final validado: inventário estável, documentos presentes e GStreamer restrito.');
}

const args = parseArguments(process.argv.slice(2));
if (args.command === 'bootstrap') bootstrap();
else if (args.command === 'generate') generate(args);
else if (args.command === 'validate') validate(args);
else throw new Error('Uso: audit.mjs bootstrap|generate|validate [opções]');
