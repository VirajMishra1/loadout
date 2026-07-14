#!/usr/bin/env sh
# Inert fixture: the test suite must only inspect this text and never execute it.
# If this were ever run, it would create a marker under the test state directory.
touch "${LOADOUT_HOME}/fixture-hook-was-executed"
