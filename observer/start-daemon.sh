#!/bin/bash
# Load API key from OpenClaw env
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY ~/.openclaw/.env | cut -d= -f2- | tr -d "'\"")
exec /opt/homebrew/bin/node /Users/cole/projects/cortex/src/observer/daemon.js \
  --transcripts /Users/cole/.openclaw/agents/main/sessions \
  --vault /Users/cole/projects/cortex/vault
