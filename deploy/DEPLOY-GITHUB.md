# Auto-deploy on merge to main

`.github/workflows/deploy.yml` SSHes to the droplet on every push to `main` and
runs `sudo bonita` (= `deploy/update.sh`: git pull + optional bca-api refresh +
`nginx -t` + reload). It replaces the manual "SSH in and run `sudo bonita`" step.

The workflow re-checks that generated output is fresh before it deploys, so a
direct push that skipped the PR gate can't ship stale bytes.

## One-time setup

### 1. A dedicated deploy key (on any machine)

```bash
ssh-keygen -t ed25519 -f bca-deploy -C "github-actions-deploy" -N ""
```

Append the **public** key to the droplet deploy user's `authorized_keys`:

```bash
ssh YOUR_DROPLET 'cat >> ~/.ssh/authorized_keys' < bca-deploy.pub
```

### 2. Let that user run only `bonita` as root without a password

On the droplet, as root:

```bash
echo 'DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/bin/bonita' > /etc/sudoers.d/bonita
chmod 440 /etc/sudoers.d/bonita
visudo -c   # validate
```

Replace `DEPLOY_USER` with the account whose `authorized_keys` you edited. This
grants exactly one command — not blanket root.

### 3. Repo secrets

In GitHub → the repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | droplet hostname or IP |
| `DEPLOY_USER` | the deploy user from step 2 |
| `DEPLOY_SSH_KEY` | contents of the **private** `bca-deploy` file |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 YOUR_DROPLET` (pins the host key so the deploy can't be MITM'd) |

### 4. Guard main with the freshness check

Under **Settings → Branches**, protect `main` and require the **generated assets
fresh** check to pass before merge. Then everything on `main` is already
regenerated, and the deploy's own re-check is just a backstop.

## Verifying / rolling back

- Watch a deploy under the repo's **Actions** tab; re-run manually via
  **workflow_dispatch** if a deploy needs repeating.
- `sudo bonita` is `--ff-only`, so it never rewrites droplet history. To roll
  back, revert the offending commit on `main` — the next deploy pulls the revert.
- Delete the four secrets (or the workflow) to fall back to manual `sudo bonita`.
