#!/usr/bin/env bash
#
# cleanup-repo.sh  —  Emergent Energy Web App repo de-bloat
# Run this IN THE REPLIT SHELL, from the repo root.
#
# What it does:
#   - Backs up your FULL original history to a GitHub branch (recoverable).
#   - Purges ~240 MB of junk from ALL history:
#       * attached_assets/*.png  (1,091 Replit paste screenshots, 160 MB)
#       * attached_assets/*.jpeg / *.jpg
#       * attached_assets/*.zip
#       * backup_before_migration_*.dump  (79 MB DB dump, referenced nowhere)
#   - KEEPS: all spreadsheets (.xlsm/.xlsx incl. the 4 test fixtures),
#            migrations/meta/*.json (Drizzle needs them), all source.
#   - Adds .gitignore rules so the junk never comes back.
#   - Force-pushes the rewritten main and reclaims local space.
#
# It STOPS and asks you to type CLEANUP before the destructive force-push.
# Nothing is irreversible until that push — and even then, the backup branch
# on GitHub holds your original history.
#
set -euo pipefail

# ----- CONFIG -----------------------------------------------------------------
REMOTE_URL="https://github.com/JohannesTheoPotgieter/Emergent-Energy-Web-App.git"
BRANCH="main"
BACKUP_BRANCH="backup-pre-cleanup-$(date +%Y%m%d-%H%M%S)"
# ------------------------------------------------------------------------------

say()  { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!! %s\033[0m\n' "$*"; }

# 0. Sanity: are we in the right repo with a clean tree?
say "0. Pre-flight checks"
git rev-parse --is-inside-work-tree >/dev/null || { warn "Not a git repo. cd into the repo root first."; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  warn "You have uncommitted changes. Commit or stash them first, then re-run."
  git status --short
  exit 1
fi
CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "On branch: $CUR_BRANCH"
[ "$CUR_BRANCH" = "$BRANCH" ] || { warn "Expected to be on '$BRANCH', you are on '$CUR_BRANCH'. Switch first."; exit 1; }
echo "Repo size before:"; du -sh .git

# 1. Backup ORIGINAL history to a GitHub branch (your safety net).
say "1. Pushing full original history to backup branch: $BACKUP_BRANCH"
git push origin "${BRANCH}:refs/heads/${BACKUP_BRANCH}"
echo "Backup branch pushed. If anything goes wrong, restore with:"
echo "    git fetch origin && git reset --hard origin/${BACKUP_BRANCH} && git push --force origin ${BRANCH}"

# 2. Ensure git-filter-repo is available.
say "2. Ensuring git-filter-repo is installed"
if ! git filter-repo --version >/dev/null 2>&1; then
  echo "Installing git-filter-repo via pip..."
  pip install --user git-filter-repo >/dev/null 2>&1 || pip install git-filter-repo
  export PATH="$HOME/.local/bin:$PATH"
fi
git filter-repo --version

# 3. Show what dominates history (analysis only, no changes).
say "3. History analysis (no changes made)"
git filter-repo --analyze || true
echo "Detailed report (largest blobs by total size across history):"
sed -n '1,25p' .git/filter-repo/analysis/blob-shas-and-paths.txt 2>/dev/null || true

# 4. CONFIRMATION GATE before any rewrite.
say "4. Confirmation"
warn "Next step REWRITES every commit and FORCE-PUSHES over '$BRANCH'."
warn "Your original history is safe on branch '$BACKUP_BRANCH'."
read -r -p "Type CLEANUP to proceed (anything else aborts): " CONFIRM
[ "$CONFIRM" = "CLEANUP" ] || { warn "Aborted. No changes pushed."; exit 1; }

# 5. Purge junk from ALL history.
say "5. Rewriting history (removing junk from every commit)"
git filter-repo --force \
  --invert-paths \
  --path-glob 'attached_assets/*.png' \
  --path-glob 'attached_assets/*.jpeg' \
  --path-glob 'attached_assets/*.jpg' \
  --path-glob 'attached_assets/*.zip' \
  --path-glob '*.dump'

# 6. Add recurrence-prevention .gitignore rules (idempotent).
say "6. Updating .gitignore"
add_ignore() { grep -qxF "$1" .gitignore 2>/dev/null || echo "$1" >> .gitignore; }
{
  echo ""
  echo "# -- Replit paste artefacts & DB dumps (never source) --"
} >> .gitignore
add_ignore 'attached_assets/*.png'
add_ignore 'attached_assets/*.jpeg'
add_ignore 'attached_assets/*.jpg'
add_ignore 'attached_assets/*.zip'
add_ignore '*.dump'
git add .gitignore
git commit -m "chore: ignore Replit paste artefacts and DB dumps" || true

# 7. Re-add origin (filter-repo removes it as a safety measure) and force-push.
say "7. Force-pushing rewritten history"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE_URL"
git push --force origin "$BRANCH"

# 8. Reclaim local space.
say "8. Reclaiming local space"
git reflog expire --expire=now --all
git gc --prune=now --aggressive
echo "Repo size after:"; du -sh .git

say "DONE"
echo "Verify the app still builds/tests:  npm ci && npm run check && npm run test"
echo "Backup branch (original history): $BACKUP_BRANCH  (delete it once you're happy:"
echo "    git push origin --delete $BACKUP_BRANCH )"
