#!/bin/zsh
cd "${0:A:h}"
export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node launcher.mjs
