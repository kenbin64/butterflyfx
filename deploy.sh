#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# BUTTERFLYFX — Deploy / Update Script
# Static-only site. Copies public/ to /var/www/butterflyfx.us/public.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SRC="/home/butterfly/apps/butterflyfx/public"
DST="/var/www/butterflyfx.us/public"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; NC='\033[0m'
echo -e "${Y}ButterflyFX — Deploy  $(date +%Y%m%d_%H%M%S)${NC}"

if [[ ! -d "$SRC" ]]; then echo -e "${R}  ✗ source missing: $SRC${NC}"; exit 1; fi
if [[ ! -d "$DST" ]]; then echo -e "${R}  ✗ destination missing: $DST  (provision first)${NC}"; exit 1; fi

# Sync — preserve .well-known/ for certbot
rsync -a --exclude='.well-known' "$SRC/" "$DST/"
echo -e "${G}  ✓ static files synced${NC}"

if command -v nginx >/dev/null 2>&1; then
  # Avoid interactive sudo password prompts during deploy.
  if nginx -t 2>/dev/null; then
    systemctl reload nginx || true
    echo -e "${G}  ✓ nginx reloaded${NC}"
  elif sudo -n nginx -t 2>/dev/null; then
    sudo systemctl reload nginx || true
    echo -e "${G}  ✓ nginx reloaded${NC}"
  else
    echo -e "${R}  ✗ nginx reload skipped (no permissions or config invalid)${NC}"
  fi
fi

echo -e "${G}done — https://butterflyfx.us${NC}"
