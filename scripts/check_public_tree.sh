#!/usr/bin/env bash
set -euo pipefail

if git grep -I -l -E '(/Users/|/home/|[A-Za-z]:\\Users\\)' -- ':!scripts/check_public_tree.sh'; then
  echo "Personal absolute path found in tracked content" >&2
  exit 1
fi
if git ls-files | grep -E '(^|/)(credentials\.json|token\.json|.*\.db|.*\.sqlite|.*\.pem|.*\.key|local\.properties)$'; then
  echo "Credential or local-data artifact is tracked" >&2
  exit 1
fi
if git ls-files | grep -E '(^|/)(\.sessions|\.threads|\.jobs|\.captures|captures|recordings|artifacts)/|\.(wav|mp3|webm|png|jpe?g)$'; then
  echo "Private session, capture, recording, or media material is tracked" >&2
  exit 1
fi
