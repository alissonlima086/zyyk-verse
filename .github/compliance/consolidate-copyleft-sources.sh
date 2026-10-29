#!/usr/bin/env bash
set -Eeuo pipefail

OUTPUT_ARCHIVE="${1:?Informe o arquivo consolidado de saída}"
shift
[[ "$#" -ge 2 ]] || { echo 'Informe ao menos dois pacotes por arquitetura.' >&2; exit 1; }

VERSION="$(node --print "require('./package.json').version")"
ARCHIVE_ROOT="ZYYK-Verse-${VERSION}-third-party-copyleft-sources"
TEMP_DIR="$(mktemp -d)"
ROOT_DIR="$TEMP_DIR/$ARCHIVE_ROOT"
trap 'rm -rf -- "$TEMP_DIR"' EXIT
mkdir -p "$ROOT_DIR"

merge_tree() {
  local source_root="$1"
  while IFS= read -r -d '' source; do
    local relative="${source#"$source_root"/}"
    local destination="$ROOT_DIR/$relative"
    if [[ -d "$source" ]]; then
      mkdir -p "$destination"
    elif [[ -L "$source" ]]; then
      if [[ -e "$destination" || -L "$destination" ]]; then
        [[ -L "$destination" && "$(readlink "$source")" == "$(readlink "$destination")" ]] || {
          echo "Fontes divergentes entre arquiteturas: $relative" >&2
          exit 1
        }
      else
        cp -a -- "$source" "$destination"
      fi
    elif [[ -e "$destination" ]]; then
      cmp --silent "$source" "$destination" || {
        echo "Fontes divergentes entre arquiteturas: $relative" >&2
        exit 1
      }
    else
      mkdir -p "$(dirname "$destination")"
      cp -a -- "$source" "$destination"
    fi
  done < <(find "$source_root" -mindepth 1 -print0)
}

for archive in "$@"; do
  [[ -s "$archive" ]] || { echo "Pacote de fontes ausente: $archive" >&2; exit 1; }
  extracted="$TEMP_DIR/extracted-$(basename "$archive" .tar.gz)"
  mkdir -p "$extracted"
  tar -xzf "$archive" -C "$extracted" --strip-components=1
  merge_tree "$extracted"
done

(
  cd "$ROOT_DIR"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
)
mkdir -p "$(dirname "$OUTPUT_ARCHIVE")"
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -czf "$OUTPUT_ARCHIVE" -C "$TEMP_DIR" "$ARCHIVE_ROOT"
test -s "$OUTPUT_ARCHIVE"
echo "Pacote copyleft consolidado em: $OUTPUT_ARCHIVE"
