#!/usr/bin/env bash
set -Eeuo pipefail

OUTPUT_ARCHIVE="${1:?Informe o caminho do arquivo de código-fonte correspondente}"
COMPLIANCE_DIR="${2:-.compliance}"
VERSION="$(node --print "require('./package.json').version")"
ARCHIVE_ROOT="ZYYK-Verse-${VERSION}-source"
TEMP_DIR="$(mktemp -d)"
ROOT_DIR="$TEMP_DIR/$ARCHIVE_ROOT"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

mkdir -p \
  "$ROOT_DIR/third-party-sources/native" \
  "$ROOT_DIR/third-party-sources/cargo" \
  "$ROOT_DIR/third-party-sources/npm" \
  "$ROOT_DIR/compliance"
git archive HEAD | tar -x -C "$ROOT_DIR"

native_manifest="$COMPLIANCE_DIR/copyleft-native-sources.tsv"
cargo_manifest="$COMPLIANCE_DIR/copyleft-cargo-sources.tsv"
frontend_manifest="$COMPLIANCE_DIR/copyleft-frontend-sources.tsv"
for manifest in "$native_manifest" "$cargo_manifest" "$frontend_manifest"; do
  [[ -f "$manifest" ]] || { echo "Manifesto de fontes ausente: $manifest" >&2; exit 1; }
done

unavailable_native_sources=()
while IFS=$'\t' read -r source_package source_version; do
  [[ -n "$source_package" ]] || continue
  # Use o mesmo resolvedor do download real. --print-uris valida a versão e
  # mostra os objetos que seriam obtidos sem transferi-los para o runner.
  if ! apt-get source --download-only --print-uris \
    "${source_package}=${source_version}" >/dev/null 2>&1; then
    unavailable_native_sources+=("${source_package}=${source_version}")
  fi
done < "$native_manifest"

if [[ "${#unavailable_native_sources[@]}" -gt 0 ]]; then
  printf 'Fontes Ubuntu exatas indisponíveis nos índices configurados:\n' >&2
  printf '  - %s\n' "${unavailable_native_sources[@]}" >&2
  exit 1
fi

while IFS=$'\t' read -r source_package source_version; do
  [[ -n "$source_package" ]] || continue
  (
    cd "$ROOT_DIR/third-party-sources/native"
    apt-get source --download-only "${source_package}=${source_version}"
  )
done < "$native_manifest"

while IFS=$'\t' read -r name version source_path license; do
  [[ -n "$name" ]] || continue
  [[ -d "$source_path" ]] || { echo "Fonte Cargo ausente: $name $version ($source_path)" >&2; exit 1; }
  target="$ROOT_DIR/third-party-sources/cargo/${name}-${version}"
  [[ ! -e "$target" ]] || { echo "Fonte Cargo duplicada: $name $version" >&2; exit 1; }
  cp -a -- "$source_path" "$target"
done < "$cargo_manifest"

while IFS=$'\t' read -r name version license; do
  [[ -n "$name" ]] || continue
  (
    cd "$ROOT_DIR/third-party-sources/npm"
    npm pack --ignore-scripts "${name}@${version}" >/dev/null
  )
done < "$frontend_manifest"

cp "$native_manifest" "$ROOT_DIR/third-party-sources/native-sources.tsv"
cp "$cargo_manifest" "$ROOT_DIR/third-party-sources/cargo-sources.tsv"
cp "$frontend_manifest" "$ROOT_DIR/third-party-sources/frontend-sources.tsv"
cp "$COMPLIANCE_DIR/THIRD_PARTY_NOTICES.md" "$ROOT_DIR/compliance/"
cp "$COMPLIANCE_DIR/SOURCE_OFFER.md" "$ROOT_DIR/compliance/"
cp "$COMPLIANCE_DIR/SBOM.spdx.json" "$ROOT_DIR/compliance/"
cp "$COMPLIANCE_DIR/AUDIT_REPORT.md" "$ROOT_DIR/compliance/"

printf '%s\n' \
  "Código-fonte correspondente do ZYYK Verse ${VERSION}" \
  '' \
  'A raiz contém o código do Verse e seus arquivos de build. O diretório' \
  'third-party-sources contém as fontes correspondentes dos componentes copyleft' \
  'efetivamente encontrados no AppImage, separadas em native, cargo e npm.' \
  '' \
  'Avisos, SBOM, oferta de fontes e relatório de auditoria estão em compliance/.' \
  > "$ROOT_DIR/README.txt"

(
  cd "$ROOT_DIR"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
)

mkdir -p "$(dirname "$OUTPUT_ARCHIVE")"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -czf "$OUTPUT_ARCHIVE" -C "$TEMP_DIR" "$ARCHIVE_ROOT"
test -s "$OUTPUT_ARCHIVE"
echo "Código-fonte correspondente preservado em: $OUTPUT_ARCHIVE"
