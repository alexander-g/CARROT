#!/bin/bash

set -e

./deno.sh run                                      \
    --config=./deno.jsonc                          \
    --allow-read=./                                \
    --allow-write=./static/                        \
    --unstable-bundle                              \
    --no-prompt                                    \
    --cached-only                                  \
    base/backend/ts/build.ts                       \
    --mode=web                                     \
    --static=./static/                             \
    --srcdirs=frontend/,base/frontend/             \
    --index_tsx=frontend/index.tsx                 \
    --extra_bundle=frontend/lib/carrot_worker.ts   \
    --copy_globs=frontend/css/treerings.css,frontend/favicon.ico,frontend/logo.svg

# delete the uuid folder
rm -r static/*-*-*-*
