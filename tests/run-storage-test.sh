#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h:h}"
binary="/private/tmp/zetamac-storage-test-$$"
trap 'rm -f "$binary"' EXIT
clang -fobjc-arc -O1 -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers -lsqlite3 \
  "$project_dir/tests/storage.m" -o "$binary"
"$binary"
