// Linux host identity: /etc/machine-id is the canonical hardware-rooted
// host id on systemd-based distros (set once at first boot by systemd-
// machine-id-setup, persists across reboots, opaque 128-bit hex). On
// non-systemd or pre-boot environments where /etc/machine-id is absent
// or empty, fall back to /var/lib/dbus/machine-id (the older D-Bus
// location). Last resort: the hostname — not stable but never null.

import { hostname } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'

const FALLBACK_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id']

export function getLinuxHostId(): string {
  for (const path of FALLBACK_PATHS) {
    if (!existsSync(path)) continue
    try {
      const v = readFileSync(path, 'utf-8').trim()
      if (v) return v
    }
    catch { /* try next */ }
  }
  return hostname()
}

export function getLinuxHostname(): string {
  return hostname()
}
