#!/usr/bin/env bash
# Closes a coordinator's tab. "stop" ends its workers first (their tabs close
# with them); "keep" preserves the Assistant and its workers.
# Usage: close.sh <tab id> <coordinator address> stop|keep
set -u
tab=$1 coord=$2 mode=$3
if [ "$mode" = stop ]; then
  for w in $( { hc ls --json | jq -r --arg c "$coord" '.terminals[] | select(.parent == $c) | .address'
      hc ls --json --label "herdr.coordinator=$tab" | jq -r --arg c "$coord" '.terminals[] | select(.address != $c) | .address'; } | sort -u); do
    hc kill "$w" >/dev/null 2>&1
  done
  hc kill "$coord" >/dev/null 2>&1
else
  herdr-app do terminal.park --terminal "$coord" >/dev/null || exit 1
  hc keep "$coord" >/dev/null || exit 1
fi
herdr-app do tab.close --id "$tab" --confirmed true >/dev/null
