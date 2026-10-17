#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
compose=(docker compose -p k13-lectura-test -f recovery/compose.test.yml)
test_dir=$(mktemp -d /tmp/k13-lectura-e2e.XXXXXX)
cleanup() {
  "${compose[@]}" down --volumes >/dev/null
  # Directorio generado exclusivamente para este ensayo; no contiene datos reales.
  if [[ "$test_dir" == /tmp/k13-lectura-e2e.* ]]; then
    rm -f -- "$test_dir/fixture.xlsx"
    rmdir -- "$test_dir"
  fi
}
trap cleanup EXIT
./dev build-backend
"${compose[@]}" up -d --build --wait
"${compose[@]}" exec -T api node scripts/lectura-fixture.cjs > "$test_dir/fixture.xlsx"
"${compose[@]}" cp "$test_dir/fixture.xlsx" web:/tmp/lectura-fixture.xlsx >/dev/null
"${compose[@]}" exec -T -e SPRINT12_ISOLATED=1 web node scripts/importaciones-e2e.cjs
