{
  description = "Ambiente de desenvolvimento do ZYYK Verse (Tauri, Rust e Svelte)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        gstPlugins = with pkgs.gst_all_1; [
          gstreamer
          gst-plugins-base
          gst-plugins-good
          gst-plugins-bad
        ];

        libraries = with pkgs; [
          webkitgtk_4_1
          gtk3
          cairo
          gdk-pixbuf
          glib
          dbus
          openssl
          librsvg
          pango
          harfbuzz
          libsoup_3
        ] ++ gstPlugins;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            rustc
            cargo
            rustfmt
            clippy
            rust-analyzer
            nodejs_22
            corepack
            pkg-config
            gobject-introspection
          ] ++ gstPlugins;

          buildInputs = libraries;

          nativeBuildInputs = with pkgs; [
            pkg-config
            gobject-introspection
          ];

          shellHook = ''
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath libraries}:$LD_LIBRARY_PATH"
            export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
            export GST_PLUGIN_SYSTEM_PATH_1_0="${pkgs.lib.makeSearchPathOutput "lib" "lib/gstreamer-1.0" gstPlugins}"
            export WEBKIT_DISABLE_COMPOSITING_MODE=1
            export WEBKIT_DISABLE_DMABUF_RENDERER=1
            export GST_PLUGIN_FEATURE_RANK="vah264dec:NONE,vah265dec:NONE,vavp9dec:NONE,vaav1dec:NONE"

            echo "=== Ambiente de Desenvolvimento — ZYYK Verse ==="
            echo "Rust: $(rustc --version)"
            echo "Cargo: $(cargo --version)"
            echo "Node: $(node --version)"
            echo "================================================"
          '';
        };
      });
}
