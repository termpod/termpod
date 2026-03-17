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
SENTRY_DSN_VAL="${SENTRY_DSN:-}"

# Normalize WS URLs to HTTPS (AuthService handles the reverse conversion for WebSocket)
RELAY_URL=$(echo "$RELAY_URL" | sed 's|^wss://|https://|' | sed 's|^ws://|http://|')

# xcconfig treats // as a comment — extract parts and reassemble with $()/$()/ escape
PROTOCOL=$(echo "$RELAY_URL" | cut -d: -f1)
HOST=$(echo "$RELAY_URL" | sed 's|.*://||')

cat > "$CONFIG_FILE" <<'XCEOF'
// Auto-generated — do not edit. Run generate-config.sh to regenerate.
XCEOF
echo "TERMPOD_TEAM_ID = $TEAM_ID" >> "$CONFIG_FILE"
# Write xcconfig-safe URL: $() is an empty variable reference, producing just /
echo -n "TERMPOD_RELAY_URL = ${PROTOCOL}:" >> "$CONFIG_FILE"
echo -n '$()/$()/'"$HOST" >> "$CONFIG_FILE"
echo "" >> "$CONFIG_FILE"

echo "SENTRY_DSN = $SENTRY_DSN_VAL" >> "$CONFIG_FILE"

echo "Generated $CONFIG_FILE"
echo "  TERMPOD_TEAM_ID = $TEAM_ID"
echo "  TERMPOD_RELAY_URL = $RELAY_URL"
echo "  SENTRY_DSN = ${SENTRY_DSN_VAL:-<empty>}"
