#!/usr/bin/env bash
set -Eeuo pipefail

OUTPUT_ARCHIVE="${1:?Informe o caminho do arquivo de código-fonte correspondente}"
RELEASE_ARCH="${2:?Informe a arquitetura da release}"
COMPLIANCE_DIR="${3:-.compliance}"
VERSION="$(node --print "require('./package.json').version")"
ARCHIVE_ROOT="ZYYK-Verse-${VERSION}-${RELEASE_ARCH}-third-party-copyleft-sources"
TEMP_DIR="$(mktemp -d)"
ROOT_DIR="$TEMP_DIR/$ARCHIVE_ROOT"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

mkdir -p \
  "$ROOT_DIR/third-party-sources/native" \
  "$ROOT_DIR/third-party-sources/cargo" \
  "$ROOT_DIR/third-party-sources/npm" \
  "$ROOT_DIR/manifests/$RELEASE_ARCH" \
  "$ROOT_DIR/compliance/$RELEASE_ARCH"

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

cp "$native_manifest" "$ROOT_DIR/manifests/$RELEASE_ARCH/native-sources.tsv"
cp "$cargo_manifest" "$ROOT_DIR/manifests/$RELEASE_ARCH/cargo-sources.tsv"
cp "$frontend_manifest" "$ROOT_DIR/manifests/$RELEASE_ARCH/frontend-sources.tsv"
cp "$COMPLIANCE_DIR/THIRD_PARTY_NOTICES.md" "$ROOT_DIR/compliance/$RELEASE_ARCH/"
cp "$COMPLIANCE_DIR/SOURCE_OFFER.md" "$ROOT_DIR/compliance/$RELEASE_ARCH/"
cp "$COMPLIANCE_DIR/SBOM.spdx.json" "$ROOT_DIR/compliance/$RELEASE_ARCH/"
cp "$COMPLIANCE_DIR/AUDIT_REPORT.md" "$ROOT_DIR/compliance/$RELEASE_ARCH/"

printf '%s\n' \
  "Fontes de terceiros copyleft distribuídas pelo ZYYK Verse ${VERSION}" \
  '' \
  'third-party-sources contém as fontes dos componentes copyleft efetivamente' \
  'encontrados nos AppImages, separadas em native, cargo e npm.' \
  '' \
  'manifests/ e compliance/ separam a proveniência e a auditoria por arquitetura.' \
  'O código do Verse é disponibilizado pelos arquivos Source code da tag no GitHub.' \
  > "$ROOT_DIR/README.txt"

mkdir -p "$(dirname "$OUTPUT_ARCHIVE")"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -czf "$OUTPUT_ARCHIVE" -C "$TEMP_DIR" "$ARCHIVE_ROOT"
test -s "$OUTPUT_ARCHIVE"
echo "Fontes copyleft de $RELEASE_ARCH preservadas em: $OUTPUT_ARCHIVE"
