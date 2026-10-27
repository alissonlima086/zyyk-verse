#!/usr/bin/env bash
set -Eeuo pipefail

APPDIR="${1:?Informe o AppDir extraído}"
LIBRARY_ROOT="$APPDIR/usr/lib"
DOCUMENT_ROOT="$APPDIR/usr/share/doc"

[[ -d "$LIBRARY_ROOT" ]] || {
  echo "O AppImage extraído não contém usr/lib: $APPDIR" >&2
  exit 1
}

declare -A packages=()

# O linuxdeploy nem sempre preserva /usr/share/doc, embora copie as bibliotecas.
# Relacione cada objeto compartilhado efetivamente distribuído ao pacote instalado
# no runner e restaure apenas o respectivo aviso copyright para a auditoria.
while IFS= read -r -d '' object; do
  name="$(basename "$object")"
  while IFS= read -r ownership; do
    [[ "$ownership" == *': '* ]] || continue
    package="${ownership%%: *}"
    installed_path="${ownership#*: }"
    [[ "$(basename "$installed_path")" == "$name" ]] || continue
    case "$installed_path" in
      /lib/*|/usr/lib/*) packages["$package"]=1 ;;
    esac
  done < <(dpkg-query -S "*/$name" 2>/dev/null || true)
done < <(find -L "$LIBRARY_ROOT" -type f \( -name '*.so' -o -name '*.so.*' \) -print0)

if [[ "${#packages[@]}" -eq 0 ]]; then
  echo "Nenhum pacote Ubuntu pôde ser associado às bibliotecas do AppImage." >&2
  exit 1
fi

copied=0
for package in "${!packages[@]}"; do
  copyright="$(dpkg-query -L "$package" 2>/dev/null \
    | sed -n '/\/usr\/share\/doc\/[^/]*\/copyright$/p' \
    | head -n 1)"
  [[ -n "$copyright" && -f "$copyright" ]] || continue
  package_doc="$(basename "$(dirname "$copyright")")"
  mkdir -p "$DOCUMENT_ROOT/$package_doc"
  cp -L "$copyright" "$DOCUMENT_ROOT/$package_doc/copyright"
  copied=$((copied + 1))
done

if [[ "$copied" -eq 0 ]]; then
  echo "Nenhum aviso copyright nativo pôde ser preparado para a auditoria." >&2
  exit 1
fi

echo "$copied avisos copyright nativos preparados a partir das bibliotecas distribuídas."
