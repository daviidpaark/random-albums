#!/usr/bin/env bash
# random-albums Spicetify uninstaller
# One-liner: bash <(curl -s "https://raw.githubusercontent.com/daviidpaark/random-albums/main/uninstall.sh")

set -euo pipefail

if ! command -v spicetify &>/dev/null; then
  echo "Error: spicetify not found in PATH." >&2
  exit 1
fi

SPICE_PATH="$(spicetify -c | xargs dirname)"
CONFIG_FILE="$SPICE_PATH/config-xpui.ini"
APPS=("random-albums")

# ── 1. Remove app folders ─────────────────────────────────────────────────────
for app in "${APPS[@]}"; do
  dest="$SPICE_PATH/CustomApps/$app"
  if [[ -d "$dest" ]]; then
    rm -rf "$dest"
    echo "Removed $dest"
  else
    echo "'$app' folder not found, skipping."
  fi
done

# ── 2. Deregister from config-xpui.ini ───────────────────────────────────────
for app in "${APPS[@]}"; do
  current="$(grep -E '^custom_apps\s*=' "$CONFIG_FILE" | sed 's/^custom_apps\s*=\s*//')"

  # Build new value with this app removed
  new_val="$(echo "$current" | tr '|' '\n' | grep -vx "$app" | paste -sd '|' -)"

  sed -i.bak "s|^custom_apps\s*=.*|custom_apps           = $new_val|" "$CONFIG_FILE"
  rm -f "$CONFIG_FILE.bak"
  echo "Removed '$app' from config-xpui.ini"
done

# ── 3. Apply ──────────────────────────────────────────────────────────────────
echo ""
echo "Applying spicetify..."
spicetify apply
echo ""
echo "Done! Restart Spotify if it's already open."
