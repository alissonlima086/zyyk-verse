#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION=""
BUMP_KIND="patch"
RESUME=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Uso:
  bash scripts/release.sh                    # incrementa o patch da última tag remota
  bash scripts/release.sh 0.2.0              # publica uma versão explícita
  bash scripts/release.sh --bump minor       # incrementa major, minor ou patch
  bash scripts/release.sh --resume 0.2.0      # retoma após merge, build ou tag
  bash scripts/release.sh --dry-run [VERSÃO] # apenas resolve e valida a versão

Antes do fluxo normal, registre as mudanças nas seções English e Português de
[Unreleased] no CHANGELOG.md. O script cria branch, atualiza versões, valida,
commita, abre e mescla o PR, aguarda os candidatos Linux e Windows, cria a tag
e publica a release.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)
      BUMP_KIND="${2:?Informe patch, minor ou major}"
      shift 2
      ;;
    --resume)
      RESUME=true
      VERSION="${2:?Informe a versão que será retomada}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    v[0-9]*|[0-9]*)
      [[ -z "$VERSION" ]] || { echo "Informe somente uma versão." >&2; exit 2; }
      VERSION="$1"
      shift
      ;;
    *)
      echo "Argumento desconhecido: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$BUMP_KIND" in patch|minor|major) ;; *) echo "Incremento inválido: $BUMP_KIND" >&2; exit 2;; esac

if command -v gh >/dev/null 2>&1; then
  GH=(gh)
elif command -v nix >/dev/null 2>&1; then
  GH=(nix shell nixpkgs#gh --command gh)
else
  echo "GitHub CLI (gh) ou Nix é necessário." >&2
  exit 1
fi

gh_cmd() { "${GH[@]}" "$@"; }

latest_remote_version() {
  git ls-remote --tags --refs origin 'v[0-9]*' \
    | sed -n 's#.*refs/tags/v##p' \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -1
}

bump_version() {
  node --input-type=module -e \
    "import { bumpVersion } from './scripts/prepare-release.mjs'; console.log(bumpVersion(process.argv[1], process.argv[2]));" \
    "$1" "$2"
}

wait_for_run() {
  local workflow="$1" sha="$2" run_id=""
  for _attempt in {1..60}; do
    run_id="$(gh_cmd run list --workflow "$workflow" --limit 30 \
      --json databaseId,headSha \
      --jq ".[] | select(.headSha == \"$sha\") | .databaseId" | head -1)"
    [[ -z "$run_id" ]] || { printf '%s\n' "$run_id"; return 0; }
    sleep 5
  done
  echo "Workflow $workflow não encontrado para $sha." >&2
  return 1
}

wait_for_pr_checks() {
  local pr="$1" check_count=""
  for _attempt in {1..60}; do
    check_count="$(gh_cmd pr view "$pr" --json statusCheckRollup \
      --jq '.statusCheckRollup | length')"
    if [[ "$check_count" -gt 0 ]]; then
      gh_cmd pr checks "$pr" --watch --interval 10
      return 0
    fi
    echo "Checks do pull request ainda não registrados (${_attempt}/60)."
    sleep 5
  done
  echo "Nenhum check foi registrado para $pr em 5 minutos." >&2
  return 1
}

validate_version_files() {
  local expected="$1"
  local package_version tauri_version cargo_version
  package_version="$(node --print "require('./package.json').version")"
  tauri_version="$(node --print "require('./src-tauri/tauri.conf.json').version")"
  cargo_version="$(sed -n '/^\[package\]/,/^\[/s/^version = "\([^"]*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
  [[ "$package_version" == "$expected" && "$tauri_version" == "$expected" && "$cargo_version" == "$expected" ]] || {
    echo "Versões divergentes: package=$package_version tauri=$tauri_version cargo=$cargo_version." >&2
    return 1
  }
}

command -v git >/dev/null
command -v node >/dev/null
gh_cmd auth status >/dev/null

LATEST_VERSION="$(latest_remote_version)"
[[ -n "$LATEST_VERSION" ]] || { echo "Nenhuma tag SemVer encontrada em origin." >&2; exit 1; }
VERSION="${VERSION#v}"
if [[ -z "$VERSION" ]]; then VERSION="$(bump_version "$LATEST_VERSION" "$BUMP_KIND")"; fi
node --input-type=module -e \
  "import { parseVersion } from './scripts/prepare-release.mjs'; parseVersion(process.argv[1]);" "$VERSION"

if [[ "$RESUME" == false ]]; then
  [[ "$VERSION" != "$LATEST_VERSION" && "$(printf '%s\n%s\n' "$LATEST_VERSION" "$VERSION" | sort -V | tail -1)" == "$VERSION" ]] || {
    echo "A versão alvo $VERSION precisa ser superior à última versão remota $LATEST_VERSION." >&2
    exit 1
  }
fi

echo "Última versão remota: $LATEST_VERSION"
echo "Versão alvo: v$VERSION"
if [[ "$DRY_RUN" == true ]]; then exit 0; fi

if [[ "$RESUME" == false ]]; then
  [[ "$(git branch --show-current)" == "main" ]] || { echo "Inicie o release a partir de main." >&2; exit 1; }
  git fetch origin main --tags --prune
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || {
    echo "main local não está sincronizada com origin/main." >&2
    exit 1
  }
  [[ -z "$(git status --porcelain)" ]] || {
    echo "A árvore de trabalho precisa estar limpa antes de preparar o release." >&2
    exit 1
  }
  git ls-remote --exit-code --tags origin "refs/tags/v$VERSION" >/dev/null 2>&1 && {
    echo "A tag v$VERSION já existe em origin." >&2
    exit 1
  }

  RELEASE_BRANCH="release/v$VERSION"
  git switch -c "$RELEASE_BRANCH"
  node scripts/prepare-release.mjs "$VERSION" "$LATEST_VERSION" "$(date +%F)"
  validate_version_files "$VERSION"
  git diff --check
  npm run test
  npm run check
  if command -v nix >/dev/null 2>&1; then
    nix develop path:.nix --command cargo test --manifest-path src-tauri/Cargo.toml --offline --locked
  else
    cargo test --manifest-path src-tauri/Cargo.toml --locked
  fi

  git add -A
  git diff --cached --check
  git commit -m "release: prepare v$VERSION"
  git push --set-upstream origin "$RELEASE_BRANCH"

  PR_URL="$(gh_cmd pr create --base main --head "$RELEASE_BRANCH" \
    --title "Release v$VERSION" \
    --body "Prepare ZYYK Verse v$VERSION from the bilingual changelog and validated project sources.")"
  echo "Pull request: $PR_URL"
  wait_for_pr_checks "$PR_URL"
  gh_cmd pr merge "$PR_URL" --merge --delete-branch
  git switch main
  git pull --ff-only origin main
else
  [[ -z "$(git status --porcelain)" ]] || {
    echo "Para retomar um release, deixe a árvore de trabalho limpa." >&2
    exit 1
  }
  git switch main
  git pull --ff-only origin main
  validate_version_files "$VERSION"
fi

MERGE_SHA="$(git rev-parse HEAD)"
BUILD_RUN="$(wait_for_run build.yml "$MERGE_SHA")"
echo "Aguardando build candidato: https://github.com/alissonlima086/zyyk-verse/actions/runs/$BUILD_RUN"
gh_cmd run watch "$BUILD_RUN" --exit-status --interval 15

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  [[ "$(git rev-list -n 1 "v$VERSION")" == "$MERGE_SHA" ]] || {
    echo "A tag local v$VERSION aponta para outro commit." >&2
    exit 1
  }
else
  git tag -a "v$VERSION" -m "ZYYK Verse $VERSION"
fi
if git ls-remote --exit-code --tags origin "refs/tags/v$VERSION" >/dev/null 2>&1; then
  REMOTE_TAG_SHA="$(git ls-remote origin "refs/tags/v$VERSION^{}" | awk '{print $1}')"
  [[ "$REMOTE_TAG_SHA" == "$MERGE_SHA" ]] || {
    echo "A tag remota v$VERSION aponta para outro commit." >&2
    exit 1
  }
else
  git push origin "v$VERSION"
fi

RELEASE_RUN="$(wait_for_run release.yml "$MERGE_SHA")"
echo "Aguardando publicação: https://github.com/alissonlima086/zyyk-verse/actions/runs/$RELEASE_RUN"
gh_cmd run watch "$RELEASE_RUN" --exit-status --interval 10
gh_cmd release view "v$VERSION" --json url --jq .url
