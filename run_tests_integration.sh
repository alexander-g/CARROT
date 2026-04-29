#!/bin/sh

set -ex

export PYTHONUNBUFFERED=1
# for debugging (no output capture + stop on fail), remove otherwise
export PYTEST_ADDOPTS="-s -x"
#pytest --disable-warnings $@ tests/testcases_integration/


COVERAGE_DIR=./tests/coverage-integration
rm -rf $COVERAGE_DIR


./deno.sh test                  \
    --allow-read=.,/tmp         \
    --allow-write=/tmp          \
    --allow-env=CMD             \
    --allow-run=python          \
    --allow-net=localhost       \
    --no-prompt                 \
    --cached-only               \
    --coverage=$COVERAGE_DIR/raw    \
    $IMPORTMAP_ARG              \
    ${@:-tests/testcases_integration}

