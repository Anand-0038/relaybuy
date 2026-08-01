#!/usr/bin/env bash

relaybuy_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
relaybuy_project_env_file="${RELAYBUY_PROJECT_ENV_FILE:-${relaybuy_script_dir}/../.env.local}"

if [ ! -f "$relaybuy_project_env_file" ]; then
  echo "RelayBuy project environment file was not found." >&2
  return 66 2>/dev/null || exit 66
fi

relaybuy_project_prava_key="$({
  awk '
    /^[[:space:]]*(export[[:space:]]+)?PRAVA_MERCHANT_SECRET_KEY=/ {
      line = $0
      sub(/^[[:space:]]*(export[[:space:]]+)?PRAVA_MERCHANT_SECRET_KEY=/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if ((substr(line, 1, 1) == "\"" && substr(line, length(line), 1) == "\"") ||
          (substr(line, 1, 1) == "\047" && substr(line, length(line), 1) == "\047")) {
        line = substr(line, 2, length(line) - 2)
      }
      print line
      exit
    }
  ' "$relaybuy_project_env_file"
} 2>/dev/null)"

if [ -z "$relaybuy_project_prava_key" ]; then
  echo "PRAVA_MERCHANT_SECRET_KEY is missing from the RelayBuy project environment." >&2
  return 65 2>/dev/null || exit 65
fi

if [ -n "${PRAVA_MERCHANT_SECRET_KEY:-}" ] &&
  [ "$PRAVA_MERCHANT_SECRET_KEY" != "$relaybuy_project_prava_key" ]; then
  echo "PRAVA_MERCHANT_SECRET_KEY conflicts with the RelayBuy project environment." >&2
  return 65 2>/dev/null || exit 65
fi

export PRAVA_MERCHANT_SECRET_KEY="$relaybuy_project_prava_key"
unset relaybuy_project_prava_key
