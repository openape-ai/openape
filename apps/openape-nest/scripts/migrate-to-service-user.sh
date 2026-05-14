#!/bin/bash
# Stage 1.5: move the running Nest to a dedicated _openape_nest service
# user. Hidden uid in the macOS service range, no shell, no GUI session,
# no FDA — same shape as Apple's _www / _postgres / etc.
#
# Steps:
#   1. Create _openape_nest user + group at uid/gid 481 (hidden)
#   2. Create /var/openape/nest data dir, chown to the service user
#   3. Copy current ~/.openape/nest/* to /var/openape/nest/* (auth.json,
#      ssh keys, agents.json, litellm/.env), preserve perms
#   4. Boot out the user-domain plist, install a system-domain plist at
#      /Library/LaunchDaemons/ai.openape.nest.plist with UserName key
#   5. Bootstrap the system-domain plist
#
# The Nest's IdP identity is bound to its ssh keypair (in step 3), not
# to the macOS user, so the migration keeps the same nest-minivonpatrick-…
# identity at id.openape.ai. No re-enroll needed. All existing approved
# delegations / grants for that identity continue to work.

set -euo pipefail

USER_NAME=_openape_nest
GROUP_NAME=_openape_nest
UID_NUM=481
GID_NUM=481
NEW_DATA_DIR=/var/openape/nest
OLD_DATA_DIR=/Users/patrickhofmann/.openape/nest
USER_PLIST=/Users/patrickhofmann/Library/LaunchAgents/ai.openape.nest.plist
SYSTEM_PLIST=/Library/LaunchDaemons/ai.openape.nest.plist
PORT=9091
NEST_BIN=/opt/homebrew/bin/openape-nest
APES_BIN=/opt/homebrew/bin/apes

echo "=== 1. Create group $GROUP_NAME (gid=$GID_NUM) ==="
if ! dscl . -read /Groups/$GROUP_NAME >/dev/null 2>&1; then
  dscl . -create /Groups/$GROUP_NAME
  dscl . -create /Groups/$GROUP_NAME PrimaryGroupID $GID_NUM
  dscl . -create /Groups/$GROUP_NAME RealName "OpenApe Nest service"
  dscl . -create /Groups/$GROUP_NAME Password "*"
  echo "  group created"
else
  echo "  group exists, skipping"
fi

echo "=== 2. Create user $USER_NAME (uid=$UID_NUM) ==="
if ! dscl . -read /Users/$USER_NAME >/dev/null 2>&1; then
  dscl . -create /Users/$USER_NAME
  dscl . -create /Users/$USER_NAME UniqueID $UID_NUM
  dscl . -create /Users/$USER_NAME PrimaryGroupID $GID_NUM
  dscl . -create /Users/$USER_NAME UserShell /usr/bin/false
  dscl . -create /Users/$USER_NAME NFSHomeDirectory $NEW_DATA_DIR
  dscl . -create /Users/$USER_NAME RealName "OpenApe Nest"
  dscl . -create /Users/$USER_NAME Password "*"
  dscl . -create /Users/$USER_NAME IsHidden 1
  echo "  user created"
else
  echo "  user exists, skipping"
fi

echo "=== 3. Provision $NEW_DATA_DIR + copy current data ==="
mkdir -p $NEW_DATA_DIR
chown $USER_NAME:$GROUP_NAME $NEW_DATA_DIR
chmod 750 $NEW_DATA_DIR

# Copy data: keep old dir intact for rollback
if [ -d "$OLD_DATA_DIR" ]; then
  cp -R "$OLD_DATA_DIR/." "$NEW_DATA_DIR/"
  chown -R $USER_NAME:$GROUP_NAME $NEW_DATA_DIR
  # restrict perms inside .config + .ssh
  find $NEW_DATA_DIR/.ssh -type f -exec chmod 600 {} \; 2>/dev/null || true
  find $NEW_DATA_DIR/.ssh -type d -exec chmod 700 {} \; 2>/dev/null || true
  find $NEW_DATA_DIR/.config -type f -exec chmod 600 {} \; 2>/dev/null || true
  find $NEW_DATA_DIR/.config -type d -exec chmod 700 {} \; 2>/dev/null || true
  echo "  data copied"
else
  echo "  WARN: $OLD_DATA_DIR not found, $NEW_DATA_DIR is empty"
fi

echo "=== 3b. Provision /var/openape/agents/ (pm2-supervisor work dir) ==="
# The nest daemon runs as the human user (Patrick) but writes per-agent
# pm2 ecosystem.config.js + start.sh files into /var/openape/agents/.
# Patrick needs group-write so a non-root mkdir-then-write works; the
# setgid bit on the parent makes new entries inherit GROUP_NAME so they
# stay accessible after a recursive chown elsewhere. Without this the
# pm2-supervisor logs "EACCES: permission denied, mkdir" on every
# reconcile and bridges never start for agents spawned via the troop UI.
AGENTS_DIR=/var/openape/agents
mkdir -p $AGENTS_DIR
chown $USER_NAME:$GROUP_NAME $AGENTS_DIR
chmod 2775 $AGENTS_DIR   # drwxrwsr-x — group-write + setgid
# Bring any existing subdirs (legacy agents from before this fix) in
# line so the supervisor can rewrite their ecosystem files.
find $AGENTS_DIR -mindepth 1 -type d -exec chmod 2775 {} \; 2>/dev/null || true
find $AGENTS_DIR -mindepth 1 -type f -exec chmod g+rw {} \; 2>/dev/null || true

echo "=== 4. Boot out user-domain plist if present ==="
if [ -f "$USER_PLIST" ]; then
  launchctl bootout gui/501/ai.openape.nest 2>/dev/null || true
  echo "  booted out"
fi

echo "=== 5. Write system-domain plist ==="
cat > $SYSTEM_PLIST <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.openape.nest</string>
    <key>UserName</key>
    <string>$USER_NAME</string>
    <key>GroupName</key>
    <string>$GROUP_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NEST_BIN</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$NEW_DATA_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$NEW_DATA_DIR</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>OPENAPE_APES_BIN</key>
        <string>$APES_BIN</string>
        <key>OPENAPE_NEST_PORT</key>
        <string>$PORT</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>/var/log/openape-nest.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/openape-nest.log</string>
</dict>
</plist>
EOF
chown root:wheel $SYSTEM_PLIST
chmod 644 $SYSTEM_PLIST
echo "  written: $SYSTEM_PLIST"

echo "=== 6. Bootstrap system-domain plist ==="
# Pre-touch logfile so launchd can write to it as the service user
touch /var/log/openape-nest.log
chown $USER_NAME:$GROUP_NAME /var/log/openape-nest.log
chmod 640 /var/log/openape-nest.log

launchctl bootout system/ai.openape.nest 2>/dev/null || true
launchctl bootstrap system $SYSTEM_PLIST
launchctl print system/ai.openape.nest | grep -E "state|active count" | head -2

echo
echo "=== migration complete ==="
echo "  user-domain plist (OLD): $USER_PLIST  ← can be deleted manually after verification"
echo "  system-domain plist (NEW): $SYSTEM_PLIST"
echo "  data dir (NEW): $NEW_DATA_DIR  (uid=$UID_NUM)"
echo "  log: /var/log/openape-nest.log"
