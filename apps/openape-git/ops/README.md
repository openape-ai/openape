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
  HostName uXXXXXX-subN.your-storagebox.de
  User uXXXXXX-subN
  Port 23
  IdentityFile ~/.ssh/id_ed25519_backup
CFG

# restic credentials, root-readable only
umask 077
openssl rand -base64 32 > ~/.config/ape-git/restic-password   # KEEP A COPY OFF-SITE
cat > ~/.config/ape-git/backup.env <<'ENV'
export RESTIC_REPOSITORY=sftp:storagebox:/ape-git
export RESTIC_PASSWORD_FILE=/home/ubuntu/.config/ape-git/restic-password
ENV

# daily at 03:17, as ubuntu — it owns /srv/ape-git, so no root is involved
crontab -l 2>/dev/null | { cat; echo '17 3 * * * . $HOME/.config/ape-git/backup.env && /home/ubuntu/ops/backup.sh >> /home/ubuntu/ape-git-backup.log 2>&1'; } | crontab -
```

Without the restic password the snapshots are unreadable — including by us.
It belongs in 1Password, not only on the VM.

## Restore

On any machine with restic, the repository URL and the password:

```bash
export RESTIC_REPOSITORY=sftp:storagebox:/ape-git RESTIC_PASSWORD_FILE=./pw
ops/restore-probe.sh patrick/m6proof
```

The probe restores the latest snapshot into a temp directory, prints the
registry it found, clones the bare repo it was asked for and shows its log.
It touches the forge VM at no point — which is the situation it exists for.
