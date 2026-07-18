#!/usr/bin/env bash

set -euo pipefail

repository_root=$(git rev-parse --show-toplevel)
verification_dir=$(mktemp -d /tmp/incentives-clean-tests.XXXXXX)

case "$verification_dir" in
  /tmp/incentives-clean-tests.*) ;;
  *)
    echo "Refusing unexpected verification directory: $verification_dir" >&2
    exit 1
    ;;
esac

cleanup() {
  rm -rf -- "$verification_dir"
}
trap cleanup EXIT

git -C "$repository_root" archive HEAD | tar -x -C "$verification_dir"
cd "$verification_dir"

pnpm install --frozen-lockfile

reset_dist() {
  local dist_dir
  for dist_dir in \
    packages/contracts/dist \
    packages/engine/dist \
    packages/module-kit/dist \
    packages/modules/promo/dist \
    packages/connector-kit/dist \
    apps/dashboard/dist \
    apps/api/dist
  do
    rm -rf -- "$verification_dir/$dist_dir"
  done
}

reset_dist
pnpm -r test

for consumer in \
  @incentives/engine \
  @incentives/connector-kit \
  @incentives/module-kit \
  @incentives/promo \
  @incentives/dashboard
do
  reset_dist
  pnpm --filter "$consumer" test
done
