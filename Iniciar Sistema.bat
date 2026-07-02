@echo off
title Controle de Patio Diversos Print
cd /d "%~dp0"
start "" http://localhost:3010
node server.js
pause
