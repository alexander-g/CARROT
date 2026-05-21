#!/bin/bash

set -ex

export PYTHONUNBUFFERED=1
# for debugging (no output capture + stop on fail), remove otherwise
export PYTEST_ADDOPTS="-s -x"
#pytest --disable-warnings $@ tests/testcases_integration/


COVERAGE_DIR=./tests/coverage-integration
rm -rf $COVERAGE_DIR

UNAME=$(uname -s)
ALLOW_RUN=$( [[ 
    "$UNAME" == CYGWIN*
    || "$UNAME" == MINGW*
    || "$UNAME" == MSYS*
    || "$UNAME" == Windows_NT 
]] && echo 'cmd.exe,taskkill' || echo 'python' )

./deno.sh test                  \
    --allow-read                \
    --allow-write=/tmp          \
    --allow-env=CMD             \
    --allow-run=$ALLOW_RUN      \
    --allow-net=127.0.0.1       \
    --no-prompt                 \
    --cached-only               \
    --coverage=$COVERAGE_DIR/raw    \
    $IMPORTMAP_ARG              \
    ${@:-tests/testcases_integration}

