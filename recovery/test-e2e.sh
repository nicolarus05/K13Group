#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
compose=(docker compose -p k13-sprint11-test -f recovery/compose.test.yml)
cleanup() {
  mkdir -p /tmp/k13-sprint11-evidence
  "${compose[@]}" cp web:/tmp/k13-sprint11-evidence/. /tmp/k13-sprint11-evidence/ >/dev/null 2>&1 || true
  # Solo recursos de este proyecto de prueba; los volúmenes de dependencias son externos.
  "${compose[@]}" down --volumes >/dev/null
}
trap cleanup EXIT
./dev build-backend
"${compose[@]}" up -d --build --wait
"${compose[@]}" exec -T -e SPRINT11_ISOLATED=1 web node scripts/configuracion-e2e.cjs
"${compose[@]}" up -d --no-deps --force-recreate --wait api worker
"${compose[@]}" exec -T -e SPRINT11_ISOLATED=1 web node scripts/configuracion-e2e.cjs persistence
