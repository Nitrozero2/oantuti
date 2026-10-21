#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

action="${1:-start}"
if [[ $# -gt 1 ]]; then
  echo 'Usage: bash worker.sh [start|stop|logs|status]' >&2
  exit 2
fi
case "$action" in
  start|stop|logs|status) ;;
  *) echo 'Usage: bash worker.sh [start|stop|logs|status]' >&2; exit 2 ;;
esac

case "$action" in
  start)
    docker load -i worker-image.tar.gz
    docker compose run --rm --no-deps worker-python --check
    docker compose up -d --no-build worker-python
    echo 'Worker started. Admin: https://oantuti-three.vercel.app/admin/workers'
    ;;
  stop) docker compose stop worker-python ;;
  logs) docker compose logs -f --tail 100 worker-python ;;
  status) docker compose ps -a worker-python ;;
esac
