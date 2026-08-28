# ape-git operations — off-site backup (plan M7)

The forge VM keeps everything that matters on one volume (`/srv/ape-git`: bare
repos + `registry.db`). This directory holds the two scripts that put a copy of
it somewhere else and prove that copy is usable.

| | |
|---|---|
| `backup.sh` | runs daily on the VM, pushes an encrypted restic snapshot off-site, writes `backup-status.json` |
| `restore-probe.sh` | run from any other machine: restores the latest snapshot and clones a repo out of it |

`GET /api/health/backup` reads `backup-status.json` and answers 503 as soon as
the last run failed or is older than 36h — that is what monitor.openape.ai
polls. A backup nobody watches is a backup nobody has.

## Off-site target

A **Hetzner Storage Box sub-account** (SFTP), i.e. a different provider than
Exoscale and a directory the forge VM cannot escape from. The plan called for
"S3-compatible storage"; restic speaks SFTP natively and the sub-account keeps
the blast radius at one directory instead of a whole object-storage account.

The sub-account is created in the Hetzner console with its own home directory;
the VM authenticates with an SSH key that exists only there.

## One-time VM setup

```bash
sudo apt-get install -y restic sqlite3

# key for the storage box sub-account (no passphrase — cron must run unattended)
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519_backup -C ape-git-backup
# → public key goes into the sub-account's authorized_keys

cat >> ~/.ssh/config <<'CFG'
Host storagebox
  HostName u341157-sub2.your-storagebox.de
  User u341157-sub2
  Port 23
  IdentityFile ~/.ssh/id_ed25519_backup
  StrictHostKeyChecking accept-new
CFG

# restic credentials, owner-readable only. The password comes from 1Password
# via secrets.openape.ai — it must exist somewhere the VM cannot lose it.
umask 077
mkdir -p ~/.config/ape-git
cat > ~/.config/ape-git/backup.env <<'ENV'
export RESTIC_REPOSITORY=sftp:storagebox:/home/restic
export RESTIC_PASSWORD_FILE=/home/ubuntu/.config/ape-git/restic-password
ENV

# daily at 03:17, as ubuntu — it owns /srv/ape-git, so no root is involved
crontab -l 2>/dev/null | { cat; echo '17 3 * * * . $HOME/.config/ape-git/backup.env && /home/ubuntu/ops/backup.sh >> /home/ubuntu/ape-git-backup.log 2>&1'; } | crontab -
```

The sub-account is chrooted, and its root shows up as `/home` over SFTP — the
repository path is `/home/restic`, not `/restic` (which fails with a bare
`SSH_FX_FAILURE`).

Without the restic password the snapshots are unreadable — including by us.
It lives in 1Password ("ape-git restic backup"), not only on the VM.

## Restore

On any machine with restic, the repository URL and the password:

```bash
export RESTIC_REPOSITORY=sftp:storagebox:/home/restic RESTIC_PASSWORD_FILE=./pw
ops/restore-probe.sh patrick/m6proof
```

The probe restores the latest snapshot into a temp directory, prints the
registry it found, clones the bare repo it was asked for and shows its log.
It touches the forge VM at no point — which is the situation it exists for.
