#!/bin/bash
# Script para detener sistema híbrido

echo "🔄 Deteniendo sistema híbrido..."

if [ -f /tmp/ble_hybrid.pids ]; then
    PIDS=$(cat /tmp/ble_hybrid.pids)
    for pid in $PIDS; do
        if kill -0 $pid 2>/dev/null; then
            echo "🛑 Deteniendo proceso $pid"
            kill $pid
        fi
    done
    rm /tmp/ble_hybrid.pids
fi

echo "✅ Sistema híbrido detenido"