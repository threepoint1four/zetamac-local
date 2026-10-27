#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h}"
app_path="$project_dir/dist/Zetamac Local.app"
binary_dir="$app_path/Contents/MacOS"
resource_dir="$app_path/Contents/Resources"
mkdir -p "$binary_dir" "$resource_dir"
clang -fobjc-arc -O2 -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers -lsqlite3 \
  "$project_dir/Sources/main.m" -o "$binary_dir/ZetamacLocal"
cp "$project_dir/Info.plist" "$app_path/Contents/Info.plist"
cp "$project_dir/Resources/index.html" "$project_dir/Resources/app.css" \
  "$project_dir/Resources/app.js" "$project_dir/Resources/core.js" "$resource_dir/"
cp "$project_dir/Resources/Icon.icns" "$resource_dir/"
codesign --force --sign - "$app_path" >/dev/null
echo "$app_path"
