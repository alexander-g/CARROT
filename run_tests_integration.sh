#!/bin/sh

export PYTHONUNBUFFERED=1
# for debugging (no output capture + stop on fail), remove otherwise
export PYTEST_ADDOPTS="-s -x"
pytest --disable-warnings $@ tests/testcases_integration/



