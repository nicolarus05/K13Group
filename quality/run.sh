#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
mode=${1:-check}
case "$mode" in check|benchmark|browser|soak) ;; *) echo 'Uso: ./dev quality {check|benchmark|browser|soak}'; exit 2;; esac
export QUALITY_SCALE=${QUALITY_SCALE:-1}
[[ "$QUALITY_SCALE" == 1 || "$QUALITY_SCALE" == 10 ]] || exit 2
run="$(date -u +%Y%m%dT%H%M%SZ)-$$"
out="$PWD/quality/results/$run"
mkdir -p "$out"
compose=(docker compose -p "k13-quality-$$" -f quality/compose.yml)
background_pid=''
cleanup() {
  code=$?
  trap - EXIT
  if [[ -n "$background_pid" ]]; then kill "$background_pid" 2>/dev/null || true; fi
  "${compose[@]}" logs --no-color > "$out/services.log" 2>&1 || true
  "${compose[@]}" down --volumes --remove-orphans --rmi local > "$out/cleanup.log" 2>&1 || code=1
  echo "Resultado: $code. Evidencias: $out"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
git rev-parse HEAD > "$out/commit.txt"
git diff --stat HEAD > "$out/changes.txt"
git status --short > "$out/source-status.txt"
# Git también enumera archivos retirados del árbol de trabajo. Registrar su
# eliminación en el estado, y calcular huellas solo de los archivos presentes.
git ls-files -c -o --exclude-standard -z | sort -zu |
  while IFS= read -r -d '' source; do
    if [[ -f "$source" ]]; then printf '%s\0' "$source"; fi
  done | xargs -0 -r sha256sum -- > "$out/sources.sha256"
docker version --format '{{.Server.Version}}' > "$out/docker.txt"
"${compose[@]}" up -d --build --wait > "$out/build.log" 2>&1
docker stats --no-stream --format '{{json .}}' $("${compose[@]}" ps -q) > "$out/resources-before.jsonl"
if [[ "$mode" == check ]]; then
  "${compose[@]}" exec -T api npm audit --audit-level=high --json > "$out/backend-audit.json"
  "${compose[@]}" exec -T web npm audit --audit-level=high --json > "$out/frontend-audit.json"
  "${compose[@]}" exec -T -e SUBSCRIPTIONS_LOAD_TEST=1 api sh -c 'npm run type-check && npm run lint && npm test -- --runInBand --testPathIgnorePatterns=integration.spec.ts && npm run test:integration' > "$out/backend.log" 2>&1
  "${compose[@]}" exec -T web sh -c 'npm run type-check && npm run lint && npm run test:ui' > "$out/frontend.log" 2>&1
  "${compose[@]}" run --rm --build recovery-tests > "$out/recovery.log" 2>&1
fi
if [[ "$mode" == soak ]]; then
  ( sleep 45; "${compose[@]}" exec -T worker python3 /opt/recovery/worker.py backup > "$out/concurrent-backup.log" ) &
  background_pid=$!
  "${compose[@]}" exec -T -e "QUALITY_SOAK_SECONDS=${QUALITY_SOAK_SECONDS:-300}" api node scripts/quality-benchmark.cjs > "$out/soak.json"
  wait "$background_pid"
  background_pid=''
elif [[ "$mode" == benchmark ]]; then
  "${compose[@]}" exec -T api node scripts/quality-benchmark.cjs > "$out/benchmark.json"
else
  "${compose[@]}" exec -T -e QUALITY_ISOLATED=1 web node scripts/quality-e2e.cjs > "$out/browser.json"
  if [[ "$mode" == check ]]; then
    "${compose[@]}" exec -T -e SPRINT13_ISOLATED=1 web node scripts/auditoria-e2e.cjs > "$out/recovery-browser.log" 2>&1
    "${compose[@]}" restart api worker >> "$out/recovery-browser.log" 2>&1
    "${compose[@]}" up -d --no-deps --wait api worker >> "$out/recovery-browser.log" 2>&1
    "${compose[@]}" exec -T -e SPRINT13_ISOLATED=1 web node scripts/auditoria-e2e.cjs persistence >> "$out/recovery-browser.log" 2>&1
  fi
fi
docker stats --no-stream --format '{{json .}}' $("${compose[@]}" ps -q) > "$out/resources-after.jsonl"
