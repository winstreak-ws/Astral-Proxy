#!/bin/bash
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

osascript -e "tell application \"Terminal\"
  do script \"${APP_DIR}/astral\"
  activate
end tell"