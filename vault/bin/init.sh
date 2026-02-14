#!/bin/bash
# cortex init — scaffold a new Cortex Vault
# Usage: cortex-init [directory]
# Idempotent: safe to run multiple times.

set -euo pipefail

TARGET="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$TARGET"
cd "$TARGET"

echo "🧠 Initializing Cortex Vault in $(pwd)"

# Git repo
if [ ! -d .git ]; then
  git init -q
  echo "   ✅ Git repo initialized"
else
  echo "   ℹ️  Git repo already exists"
fi

# Directory structure
mkdir -p bin .githooks examples

# Copy tooling (only if missing or updating)
for f in promote.mjs; do
  if [ ! -f "bin/$f" ]; then
    cp "$TEMPLATE_DIR/bin/$f" "bin/$f"
    chmod +x "bin/$f"
    echo "   ✅ Copied bin/$f"
  fi
done

cp "$TEMPLATE_DIR/bin/reindex.sh" "bin/reindex.sh"
chmod +x "bin/reindex.sh"

# Copy git hooks
cp "$TEMPLATE_DIR/.githooks/pre-commit" ".githooks/pre-commit"
cp "$TEMPLATE_DIR/.githooks/uuidv7.mjs" ".githooks/uuidv7.mjs"
chmod +x .githooks/pre-commit
echo "   ✅ Git hooks installed"

# Install hooks path
git config core.hooksPath .githooks

# CONVENTIONS.md
if [ ! -f CONVENTIONS.md ]; then
  cp "$TEMPLATE_DIR/CONVENTIONS.md" CONVENTIONS.md
  echo "   ✅ Created CONVENTIONS.md"
fi

# INDEX.md
if [ ! -f INDEX.md ]; then
  echo "# Vault Index" > INDEX.md
  echo "" >> INDEX.md
  echo "Run \`bin/reindex.sh > INDEX.md\` to regenerate." >> INDEX.md
  echo "   ✅ Created INDEX.md"
fi

# README.md
if [ ! -f README.md ]; then
  cp "$TEMPLATE_DIR/README.md" README.md
  echo "   ✅ Created README.md"
fi

# .cortexrc
if [ ! -f .cortexrc ]; then
  cat > .cortexrc << 'EOF'
{
  "vaultPath": ".",
  "user": "",
  "defaultStatus": "draft"
}
EOF
  echo "   ✅ Created .cortexrc (edit user field)"
fi

# .gitignore
if [ ! -f .gitignore ]; then
  cat > .gitignore << 'EOF'
.DS_Store
*.swp
*~
EOF
  echo "   ✅ Created .gitignore"
fi

echo ""
echo "🎉 Vault ready! Next steps:"
echo ""
echo "   1. Edit .cortexrc — set your username"
echo "   2. Write a document with YAML frontmatter (see examples/)"
echo "   3. git add & commit — the pre-commit hook auto-validates"
echo ""
echo "   Promote external docs:  node bin/promote.mjs <file> --type decision --status draft"
echo "   Regenerate index:       bash bin/reindex.sh > INDEX.md"
