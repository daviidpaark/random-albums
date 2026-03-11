#!/usr/bin/env bash
# random-albums Spicetify installer
# One-liner: bash <(curl -s "https://raw.githubusercontent.com/daviidpaark/random-albums/main/install.sh")

set -euo pipefail

REPO_BASE_URL="https://raw.githubusercontent.com/daviidpaark/random-albums/main"

get_app_files() {
  case "$1" in
    random-albums) echo "index.js manifest.json" ;;
    *)             echo "" ;;
  esac
}

# ── 1. Verify spicetify is installed ────────────────────────────────────────
if ! command -v spicetify &>/dev/null; then
  echo "Error: spicetify not found in PATH. Install it from https://spicetify.app first." >&2
  exit 1
fi

SPICE_PATH="$(spicetify -c | xargs dirname)"
CONFIG_FILE="$SPICE_PATH/config-xpui.ini"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: config-xpui.ini not found at $CONFIG_FILE. Run 'spicetify backup' first." >&2
  exit 1
fi

# Detect if running from a local clone (BASH_SOURCE[0] is /dev/fd/N when piped)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || SCRIPT_DIR="."
APPS=("random-albums")

# ── 2. Copy/download custom app files ─────────────────────────────────────────
for app in "${APPS[@]}"; do
  dest="$SPICE_PATH/CustomApps/$app"
  src="$SCRIPT_DIR/$app"

  echo "Installing $app..."
  rm -rf "$dest"
  mkdir -p "$dest"

  if [[ -d "$src" ]]; then
    cp -r "$src/." "$dest/"
    echo "  Copied to $dest"
  else
    for file in $(get_app_files "$app"); do
      echo "  Downloading $file..."
      curl -sL "$REPO_BASE_URL/$app/$file" -o "$dest/$file"
    done
    echo "  Downloaded to $dest"
  fi
done

# ── 3. Register apps in config-xpui.ini ──────────────────────────────────────
for app in "${APPS[@]}"; do
  # Read current custom_apps value
  current="$(grep -E '^custom_apps\s*=' "$CONFIG_FILE" | sed 's/^custom_apps\s*=\s*//')"

  # Check if already registered (exact match on pipe-delimited token)
  if echo "$current" | tr '|' '\n' | grep -qx "$app"; then
    echo "'$app' already registered in config-xpui.ini"
  else
    if [[ -z "$current" ]]; then
      new_val="$app"
    else
      new_val="$current|$app"
    fi
    # Replace the line in-place (compatible with both macOS and Linux sed)
    sed -i.bak "s|^custom_apps\s*=.*|custom_apps           = $new_val|" "$CONFIG_FILE"
    rm -f "$CONFIG_FILE.bak"
    echo "Registered '$app' in config-xpui.ini"
  fi
done

# ── 4. Apply ──────────────────────────────────────────────────────────────────
echo ""
echo "Applying spicetify..."
spicetify apply
echo ""
echo "Done! Restart Spotify if it's already open."
