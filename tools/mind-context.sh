#!/usr/bin/env bash
# mind-context.sh — Output top Mind entries for session bootstrap
# Usage: bash tools/mind-context.sh [limit]
# Outputs markdown-formatted Mind entries sorted by importance

set -euo pipefail

CORTEX_DIR="${CORTEX_DIR:-$HOME/projects/cortex}"
LIMIT="${1:-15}"
MIND_DIR="$CORTEX_DIR/mind"

if [ ! -d "$MIND_DIR" ]; then
    echo "No mind entries found."
    exit 0
fi

# Collect entries with importance scores
entries=()
while IFS= read -r file; do
    importance=$(grep -m1 "^importance:" "$file" | awk '{print $2}' 2>/dev/null || echo "0.5")
    entries+=("$importance|$file")
done < <(find "$MIND_DIR" -name "*.md" -type f 2>/dev/null)

if [ ${#entries[@]} -eq 0 ]; then
    echo "No mind entries found."
    exit 0
fi

# Sort by importance descending, take top N
echo "=== CORTEX MIND (top $LIMIT entries) ==="
echo ""

printf '%s\n' "${entries[@]}" | sort -t'|' -k1 -rn | head -n "$LIMIT" | while IFS='|' read -r importance file; do
    type=$(grep -m1 "^type:" "$file" | awk '{print $2}' 2>/dev/null || echo "unknown")
    title=$(grep -m1 "^# " "$file" | sed 's/^# //' 2>/dev/null || echo "(untitled)")
    # Get body (everything after frontmatter close, skip title)
    body=$(awk '/^---$/{c++; if(c==2){found=1; next}} found' "$file" | grep -v "^# " | head -3 | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-150)
    
    printf "[%s] %s (importance: %s)\n" "$type" "$title" "$importance"
    if [ -n "$body" ]; then
        printf "  %s\n" "$body"
    fi
    echo ""
done
