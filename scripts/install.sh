#!/bin/bash
set -e

APP_NAME="astral"
BIN_PATH="/usr/local/bin/$APP_NAME"
LAUNCHER_PATH="/usr/local/bin/${APP_NAME}-launcher"
ICON_PATH="/usr/share/icons/hicolor/128x128/apps/$APP_NAME.png"
DESKTOP_PATH="/usr/share/applications/$APP_NAME.desktop"

echo "[INFO] Installing $APP_NAME ..."

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

cp ./astral "$BIN_PATH"
chmod +x "$BIN_PATH"

cat > "$LAUNCHER_PATH" <<EOF
#!/bin/bash
if command -v gnome-terminal >/dev/null; then
  exec gnome-terminal -- $APP_NAME "\$@"
elif command -v konsole >/dev/null; then
  exec konsole -e $APP_NAME "\$@"
elif command -v xterm >/dev/null; then
  exec xterm -e $APP_NAME "\$@"
else
  echo "Could not find a supported terminal emulator!"
  exit 1
fi
EOF
chmod +x "$LAUNCHER_PATH"

if [ -f "./astral.png" ]; then
  cp ./astral.png "$ICON_PATH"
fi

cat > "$DESKTOP_PATH" <<EOF
[Desktop Entry]
Name=Astral Proxy
Comment=Minecraft Astral Proxy by Winstreak.ws
Exec=${APP_NAME}-launcher
Icon=$APP_NAME
Terminal=false
Type=Application
Categories=Game;Utility;
EOF

chmod 644 "$DESKTOP_PATH"

if command -v update-desktop-database >/dev/null; then
  update-desktop-database
fi
if command -v gtk-update-icon-cache >/dev/null; then
  gtk-update-icon-cache /usr/share/icons/hicolor
fi

echo "$APP_NAME installed. Start it from your menu or run '${APP_NAME}-launcher'"