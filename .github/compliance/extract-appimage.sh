#!/usr/bin/env bash
set -Eeuo pipefail

APPIMAGE="${1:?Informe o AppImage}"
DESTINATION="${2:?Informe o diretório de destino}"

[[ -f "$APPIMAGE" ]] || { echo "AppImage não encontrado: $APPIMAGE" >&2; exit 1; }
APPIMAGE="$(realpath "$APPIMAGE")"
DESTINATION="$(realpath -m "$DESTINATION")"

if [[ -e "$DESTINATION" ]]; then
  echo "O destino de extração já existe: $DESTINATION" >&2
  exit 1
fi

extracted=false
while IFS= read -r offset; do
  if unsquashfs -quiet -stat -offset "$offset" "$APPIMAGE" >/dev/null 2>&1 &&
     unsquashfs -quiet -offset "$offset" -dest "$DESTINATION" "$APPIMAGE"; then
    extracted=true
    break
  fi
done < <(grep --text --byte-offset --only-matching 'hsqs' "$APPIMAGE" | cut -d: -f1)

if [[ "$extracted" != true ]]; then
  echo "Não foi possível localizar e extrair o SquashFS do AppImage" >&2
  exit 1
fi
