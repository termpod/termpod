#!/bin/bash
# Generates Config.xcconfig from environment variables.
# Source your .env before running, or export the variables manually.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/Config.xcconfig"

# Source root .env if it exists and vars aren't already set
if [ -z "$APPLE_TEAM_ID" ] && [ -f "$SCRIPT_DIR/../../.env" ]; then
    source "$SCRIPT_DIR/../../.env"
fi

TEAM_ID="${APPLE_TEAM_ID:-}"
RELAY_URL="${VITE_RELAY_URL:-https://relay.termpod.dev}"

cat > "$CONFIG_FILE" <<EOF
// Auto-generated — do not edit. Run generate-config.sh to regenerate.
TERMPOD_TEAM_ID = $TEAM_ID
TERMPOD_RELAY_URL = $RELAY_URL
EOF

echo "Generated $CONFIG_FILE"
echo "  TERMPOD_TEAM_ID = $TEAM_ID"
echo "  TERMPOD_RELAY_URL = $RELAY_URL"
