# Source from a checkout in bash or zsh: . ./scripts/activate-node.sh
# Select an already installed Node; never download or load interactive profiles.
_openape_activate_node() {
  local root version node_bin actual
  root=$(git rev-parse --show-toplevel) || return 1
  version=$(cat "$root/.nvmrc") || return 1
  case "$version" in
    ''|*[!0-9.]*) echo 'Invalid exact Node version in .nvmrc' >&2; return 1 ;;
  esac

  if [ -n "${OPENAPE_NODE_BIN:-}" ]; then
    node_bin=$OPENAPE_NODE_BIN
  elif [ -x "${NVM_DIR:-$HOME/.nvm}/versions/node/v$version/bin/node" ]; then
    node_bin="${NVM_DIR:-$HOME/.nvm}/versions/node/v$version/bin"
  elif [ "$(node --version 2>/dev/null)" = "v$version" ]; then
    return 0
  else
    echo "Node $version is not installed for this checkout. Prepare it with nvm install, or set OPENAPE_NODE_BIN to its bin directory." >&2
    return 1
  fi

  actual=$("$node_bin/node" --version 2>/dev/null) || actual=unavailable
  if [ "$actual" != "v$version" ]; then
    echo "Expected Node v$version, found $actual in $node_bin" >&2
    return 1
  fi
  export PATH="$node_bin:$PATH"
  hash -r
}

if _openape_activate_node; then
  unset -f _openape_activate_node
else
  unset -f _openape_activate_node
  return 1
fi
