#!/bin/bash
set -e

# Finder may launch this script from a different working directory.
game_dir="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"
open "$game_dir/index.html"
