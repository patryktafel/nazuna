#!/bin/bash
# Uruchamia przegladarke w Xvfb i robi zrzut ekranu
DISPLAY_NUM=99
W=${W:-1360}
H=${H:-860}
OUT=${OUT:-/tmp/nazuna.png}
WAIT=${WAIT:-6}
pkill -f "Xvfb :$DISPLAY_NUM" 2>/dev/null
sleep 0.4
Xvfb :$DISPLAY_NUM -screen 0 ${W}x${H}x24 >/dev/null 2>&1 &
sleep 1
export DISPLAY=:$DISPLAY_NUM
export ELECTRON_DISABLE_SECURITY_WARNINGS=1
node_modules/.bin/electron --no-sandbox --disable-gpu . "$@" > /tmp/nazuna-run.log 2>&1 &
APP=$!
sleep $WAIT
import -window root "$OUT" 2>/dev/null
sleep 0.3
kill $APP 2>/dev/null
sleep 0.5
pkill -f "Xvfb :$DISPLAY_NUM" 2>/dev/null
echo "zrzut: $OUT"
