#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
compose=(docker compose -p k13-sprint13-test -f recovery/compose.test.yml)
cleanup() { "${compose[@]}" down --volumes >/dev/null; }
trap cleanup EXIT
./dev build-backend
"${compose[@]}" up -d --build --wait
"${compose[@]}" exec -T -e SPRINT13_ISOLATED=1 web node scripts/auditoria-e2e.cjs
"${compose[@]}" up -d --no-deps --force-recreate --wait api worker
"${compose[@]}" exec -T -e SPRINT13_ISOLATED=1 web node scripts/auditoria-e2e.cjs persistence
