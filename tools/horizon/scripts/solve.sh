#!/bin/bash
# usage: solve.sh name xyfile W H lo hi objs order tag
. /tmp/claude-1000/-home-thomas-dev/e89f2b33-75d7-59b5-88f7-b77d7d16fd01/scratchpad/platesolve/env.sh
cd $P/..
timeout 900 solve-field --config astrometry.cfg --no-plots --overwrite -D out_$1$9 --x-column X --y-column Y --sort-column FLUX --width $3 --height $4 --scale-units degwidth --scale-low $5 --scale-high $6 --crpix-center --tweak-order $8 --objs $7 -z 1 $EXTRA $2 > solve_$1$9.log 2>&1
echo "$1$9: $(grep -cE 'Field 1 solved' solve_$1$9.log) $(grep -E 'Field center: \(RA,' solve_$1$9.log)"
