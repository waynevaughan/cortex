#!/bin/bash
# Regenerate INDEX.md from vault document frontmatter
cd "$(dirname "$0")/.." || exit 1

echo "# Vault Index"
echo ""
echo "Auto-generated table of contents. Read this before searching — often faster than QMD for locating known topics."
echo ""
echo "Last updated: $(date +%Y-%m-%d)"
echo ""
echo "| File | Type | Status | Title | Description |"
echo "|---|---|---|---|---|"

draft=0; active=0; superseded=0; total=0

for f in $(find . -name "*.md" -not -path "./.git/*" -not -name "README.md" -not -name "CONVENTIONS.md" -not -name "INDEX.md" -not -path "./bin/*" | sort); do
  t=$(grep '^title:' "$f" 2>/dev/null | head -1 | sed 's/title: *//;s/^"//;s/"$//')
  d=$(grep '^description:' "$f" 2>/dev/null | head -1 | sed 's/description: *//;s/^"//;s/"$//')
  s=$(grep '^tags:' "$f" 2>/dev/null | grep -o 'status/[a-z]*' | head -1 | sed 's/status\///')
  tp=$(grep '^tags:' "$f" 2>/dev/null | grep -o 'type/[a-z]*' | head -1 | sed 's/type\///')
  fn=$(basename "$f")
  [ -z "$t" ] && continue
  echo "| $fn | $tp | $s | $t | $d |"
  total=$((total + 1))
  case "$s" in
    draft) draft=$((draft + 1)) ;;
    active) active=$((active + 1)) ;;
    superseded) superseded=$((superseded + 1)) ;;
  esac
done

echo ""
echo "**Total: $total documents** ($draft draft, $active active, $superseded superseded)"
