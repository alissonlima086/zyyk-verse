#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="${1:?Informe o diretório de plugins GStreamer}"
TARGET_DIR="${2:?Informe o diretório de destino}"
POLICY_FILE="${3:-$TARGET_DIR/plugin-licenses.tsv}"

plugins=(
  libgstcoreelements.so
  libgstplayback.so
  libgsttypefindfunctions.so
  libgstautodetect.so
  libgstgio.so
  libgstapp.so
  libgstaudioconvert.so
  libgstinterleave.so
  libgstaudioresample.so
  libgstaudiorate.so
  libgstvolume.so
  libgstpulseaudio.so
  libgstalsa.so
  libgstwavparse.so
  libgstaudioparsers.so
  libgstmpg123.so
  libgstflac.so
  libgstogg.so
  libgstvorbis.so
  libgstopus.so
  libgstid3demux.so
  libgstapetag.so
  libgstreplaygain.so
  libgsttaglib.so
)

mkdir -p "$TARGET_DIR"
find "$TARGET_DIR" -maxdepth 1 -type f -name 'libgst*.so' -delete

for plugin in "${plugins[@]}"; do
  source_path="$SOURCE_DIR/$plugin"
  if [[ ! -f "$source_path" ]]; then
    echo "Plugin GStreamer obrigatório não encontrado: $source_path" >&2
    exit 1
  fi
  cp -L "$source_path" "$TARGET_DIR/$plugin"
done

for plugin_path in "$TARGET_DIR"/libgst*.so; do
  plugin_name="$(basename "$plugin_path")"
  reported_license="$(GST_PLUGIN_SYSTEM_PATH_1_0="$TARGET_DIR" GST_PLUGIN_PATH_1_0="$TARGET_DIR" \
    gst-inspect-1.0 "$plugin_path" 2>/dev/null | sed -n 's/^[[:space:]]*License[[:space:]]*//p' | head -n 1)"
  version="$(GST_PLUGIN_SYSTEM_PATH_1_0="$TARGET_DIR" GST_PLUGIN_PATH_1_0="$TARGET_DIR" \
    gst-inspect-1.0 "$plugin_path" 2>/dev/null | sed -n 's/^[[:space:]]*Version[[:space:]]*//p' | head -n 1)"
  origin="$(GST_PLUGIN_SYSTEM_PATH_1_0="$TARGET_DIR" GST_PLUGIN_PATH_1_0="$TARGET_DIR" \
    gst-inspect-1.0 "$plugin_path" 2>/dev/null | sed -n 's/^[[:space:]]*Origin URL[[:space:]]*//p' | head -n 1)"
  if [[ -z "$reported_license" || -z "$version" ]]; then
    echo "Licença ou versão não identificada para o plugin GStreamer: $plugin_name" >&2
    exit 1
  fi
  case "$reported_license" in
    LGPL) license="LGPL-2.1-or-later" ;;
    MIT) license="MIT" ;;
    Apache-2.0) license="Apache-2.0" ;;
    *)
      echo "Licença GStreamer sem mapeamento SPDX explícito: $plugin_name ($reported_license)" >&2
      exit 1
      ;;
  esac
  printf '%s\t%s\t%s\t%s\t%s\n' "$plugin_name" "$version" "$license" "${origin:-https://gstreamer.freedesktop.org/}" "$reported_license"
done | sort > "$POLICY_FILE"

required_elements=(
  playbin3 decodebin3 audioconvert deinterleave audioresample volume
  mpg123audiodec flacdec vorbisdec opusdec wavparse mpegaudioparse
)
for element in "${required_elements[@]}"; do
  GST_PLUGIN_SYSTEM_PATH_1_0="$TARGET_DIR" GST_PLUGIN_PATH_1_0="$TARGET_DIR" \
    gst-inspect-1.0 "$element" >/dev/null
done
