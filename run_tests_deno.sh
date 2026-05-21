#!/bin/bash -e

COVERAGE_DIR=./tests/coverage
rm -rf $COVERAGE_DIR

IMPORTMAP_ARG=${IMPORTMAP:+--import-map="$IMPORTMAP"}

./deno.sh check $IMPORTMAP_ARG frontend/index.tsx
./deno.sh test                  \
    --allow-read=.,/tmp         \
    --allow-write=/tmp          \
    --no-prompt                 \
    --cached-only               \
    --coverage=$COVERAGE_DIR/raw    \
    $IMPORTMAP_ARG              \
    ${@:-tests/testcases_deno}

NO_COLOR=1 ./deno.sh coverage \
    --exclude=./tests \
    --exclude=./base  \
    $COVERAGE_DIR/raw \
    > $COVERAGE_DIR/coverage.txt
#./tests/combine_coverage.ts $COVERAGE_DIR/coverage.txt > $COVERAGE_DIR/coverage_summary.txt
#cat $COVERAGE_DIR/coverage_summary.txt
