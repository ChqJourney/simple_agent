#!/bin/bash

echo "Starting AI Agent Development Environment..."
echo ""

echo "[1/2] Starting Python Backend..."
osascript -e 'tell application "Terminal" to do script "cd '$(pwd)'/python_backend && python main.py"'

echo "[2/2] Waiting 3 seconds for backend to start..."
sleep 3

echo "Starting Tauri Dev..."
npm run tauri dev