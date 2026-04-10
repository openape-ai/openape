#!/bin/bash
# -----------------------------------------------------------------------------
# ape-shell login-shell wrapper
# -----------------------------------------------------------------------------
#
# The `@openape/apes` CLI is a Node.js script with a `#!/usr/bin/env node`
# shebang. When `ape-shell` is set as a user's login shell via `chsh`, the
# kernel invokes it BEFORE any rc file has run — so only the system default
# PATH is visible, which typically does NOT include Homebrew or nvm paths.
# The shebang then fails with:
#
#   env: node: No such file or directory
#
# This wrapper is the actual file pointed at by `chsh` and by the
# `/usr/local/bin/ape-shell` symlink. It:
#
#   1. Prepends known node install locations to PATH (Homebrew, nvm)
#   2. Sets APES_SHELL_WRAPPER=1 so the CLI knows it was invoked via this
#      wrapper (because argv[0]/argv[1] inspection gets clobbered when we
#      exec Node through the wrapper)
#   3. Exec's node with the real dist/cli.js path, preserving the original
#      argv[0] via `exec -a "$0"` so login-shell detection ("-ape-shell"
#      prefix) still works inside the CLI
#
# To install, point a symlink at this file:
#
#   sudo ln -sf /path/to/ape-shell-wrapper.sh /usr/local/bin/ape-shell
#   sudo chsh -s /usr/local/bin/ape-shell <user>
#
# You can override the node binary via APES_SHELL_NODE, and the CLI entry
# point via APES_SHELL_CLI_JS, for environments where the defaults don't
# apply.
# -----------------------------------------------------------------------------

set -e

# Known node install locations searched in order. The first one found wins.
# Users with exotic setups can override via APES_SHELL_NODE env var.
_node_candidates=(
  "${APES_SHELL_NODE:-}"
  "/opt/homebrew/bin/node"
  "/usr/local/bin/node"
  "/usr/bin/node"
)

_node_bin=""
for candidate in "${_node_candidates[@]}"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    _node_bin="$candidate"
    break
  fi
done

if [ -z "$_node_bin" ]; then
  echo "ape-shell: no node binary found. Install Node.js or set APES_SHELL_NODE." >&2
  exit 127
fi

# Locate the CLI JS. Default: sibling of this wrapper script via a known
# relative path (assumes the wrapper lives in packages/apes/scripts). Can be
# overridden via APES_SHELL_CLI_JS for production installs where the paths
# might differ.
#
# Symlink resolution: when the wrapper is installed as a symlink (e.g.
# /usr/local/bin/ape-shell → /path/to/packages/apes/scripts/ape-shell-wrapper.sh)
# BASH_SOURCE[0] points at the symlink, not the real file. We must walk the
# symlink chain before computing the relative `../dist/cli.js` path, otherwise
# it ends up as `/usr/local/bin/../dist/cli.js` = `/usr/local/dist/cli.js`
# which doesn't exist. macOS's readlink lacks `-f`, so use the portable
# loop idiom.
if [ -z "${APES_SHELL_CLI_JS:-}" ]; then
  _source="${BASH_SOURCE[0]}"
  while [ -L "$_source" ]; do
    _target="$(readlink "$_source")"
    case "$_target" in
      /*) _source="$_target" ;;
      *) _source="$(cd -P "$(dirname "$_source")" >/dev/null && pwd)/$_target" ;;
    esac
  done
  _wrapper_dir="$(cd -P "$(dirname "$_source")" >/dev/null && pwd)"
  _cli_js="$_wrapper_dir/../dist/cli.js"
else
  _cli_js="$APES_SHELL_CLI_JS"
fi

if [ ! -f "$_cli_js" ]; then
  echo "ape-shell: cli.js not found at $_cli_js. Set APES_SHELL_CLI_JS to override." >&2
  exit 127
fi

# Prepend common node install dirs to PATH so anything spawned inside the
# shell (or by the interactive REPL's bash child) can also find node.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Signal to the CLI that it was invoked via this wrapper, so invocation-mode
# detection can fall back to this hint when argv-based detection fails (the
# argv[1] basename check becomes `cli.js` once we exec node directly).
export APES_SHELL_WRAPPER=1

# exec -a preserves the original argv[0] that login/sshd/su gave us — notably
# the leading "-" prefix for a login shell. The CLI still sees it via
# process.argv0, so its login-shell detection keeps working.
exec -a "$0" "$_node_bin" "$_cli_js" "$@"
