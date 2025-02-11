#!/bin/bash -e

COVERAGE_DIR=./tests/coverage
rm -rf $COVERAGE_DIR

#./deno.sh check frontend/index.tsx
./deno.sh test                  \
    --allow-read=.,/tmp         \
    --allow-write=/tmp          \
    --no-prompt                 \
    --cached-only               \
    --coverage=$COVERAGE_DIR/raw    \
    ${@-tests/}

NO_COLOR=1 ./deno.sh coverage --exclude=./tests $COVERAGE_DIR/raw > $COVERAGE_DIR/coverage.txt
#./tests/combine_coverage.ts $COVERAGE_DIR/coverage.txt > $COVERAGE_DIR/coverage_summary.txt
#cat $COVERAGE_DIR/coverage_summary.txt
