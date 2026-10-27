#!/usr/bin/env bash
set -Eeuo pipefail

OUTPUT_ARCHIVE="${1:?Informe o caminho do arquivo de fontes copyleft}"
COMPLIANCE_DIR="${2:-.compliance}"
VERSION="$(node --print "require('./package.json').version")"
ARCHIVE_ROOT="ZYYK-Verse-${VERSION}-copyleft-sources"
TEMP_DIR="$(mktemp -d)"
ROOT_DIR="$TEMP_DIR/$ARCHIVE_ROOT"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

mkdir -p "$ROOT_DIR/native" "$ROOT_DIR/cargo" "$ROOT_DIR/npm"

native_manifest="$COMPLIANCE_DIR/copyleft-native-sources.tsv"
cargo_manifest="$COMPLIANCE_DIR/copyleft-cargo-sources.tsv"
frontend_manifest="$COMPLIANCE_DIR/copyleft-frontend-sources.tsv"
for manifest in "$native_manifest" "$cargo_manifest" "$frontend_manifest"; do
  [[ -f "$manifest" ]] || { echo "Manifesto de fontes ausente: $manifest" >&2; exit 1; }
done

while IFS=$'\t' read -r source_package source_version; do
  [[ -n "$source_package" ]] || continue
  (
    cd "$ROOT_DIR/native"
    apt-get source --download-only "${source_package}=${source_version}"
  )
done < "$native_manifest"

while IFS=$'\t' read -r name version source_path license; do
  [[ -n "$name" ]] || continue
  [[ -d "$source_path" ]] || { echo "Fonte Cargo ausente: $name $version ($source_path)" >&2; exit 1; }
  target="$ROOT_DIR/cargo/${name}-${version}"
  [[ ! -e "$target" ]] || { echo "Fonte Cargo duplicada: $name $version" >&2; exit 1; }
  cp -a -- "$source_path" "$target"
done < "$cargo_manifest"

while IFS=$'\t' read -r name version license; do
  [[ -n "$name" ]] || continue
  (
    cd "$ROOT_DIR/npm"
    npm pack --ignore-scripts "${name}@${version}" >/dev/null
  )
done < "$frontend_manifest"

cp "$native_manifest" "$ROOT_DIR/native-sources.tsv"
cp "$cargo_manifest" "$ROOT_DIR/cargo-sources.tsv"
cp "$frontend_manifest" "$ROOT_DIR/frontend-sources.tsv"

printf '%s\n' \
  "Fontes correspondentes copyleft do ZYYK Verse ${VERSION}" \
  '' \
  'Este arquivo foi gerado a partir dos componentes efetivamente encontrados no' \
  'AppImage. O diretório native contém os arquivos-fonte Debian/Ubuntu exatos; o' \
  'diretório cargo contém as fontes exatas das crates copyleft incorporadas; e o' \
  'diretório npm contém pacotes copyleft presentes no bundle, quando aplicável.' \
  '' \
  'Consulte SOURCE_OFFER.md e THIRD_PARTY_NOTICES.md na mesma release.' \
  > "$ROOT_DIR/README.txt"

(
  cd "$ROOT_DIR"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
)

mkdir -p "$(dirname "$OUTPUT_ARCHIVE")"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -czf "$OUTPUT_ARCHIVE" -C "$TEMP_DIR" "$ARCHIVE_ROOT"
test -s "$OUTPUT_ARCHIVE"
echo "Fontes copyleft preservadas em: $OUTPUT_ARCHIVE"
