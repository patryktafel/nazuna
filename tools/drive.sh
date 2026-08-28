#!/bin/bash
# Uruchamia przegladarke, wykonuje skrypt xdotool i robi zrzuty
DN=99
W=${W:-1360}; H=${H:-860}
pkill -f "Xvfb :$DN" 2>/dev/null; sleep 0.4
Xvfb :$DN -screen 0 ${W}x${H}x24 >/dev/null 2>&1 &
sleep 1
export DISPLAY=:$DN
export ELECTRON_DISABLE_SECURITY_WARNINGS=1
NAZUNA_START="$NAZUNA_START" NAZUNA_DEBUG=1 node_modules/.bin/electron --no-sandbox --disable-gpu . > /tmp/nazuna-run.log 2>&1 &
APP=$!
sleep ${BOOT:-7}
bash "$1"
kill $APP 2>/dev/null; sleep 0.5
pkill -f "Xvfb :$DN" 2>/dev/null
