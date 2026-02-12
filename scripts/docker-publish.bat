@echo off
REM Build and push Panel Envanter image to Docker Hub.
REM Usage: scripts\docker-publish.bat [TAG]
REM Override with DOCKER_USERNAME env if needed.

set TAG=%~1
if "%TAG%"=="" set TAG=latest

if "%DOCKER_USERNAME%"=="" set DOCKER_USERNAME=ariotiot
set IMAGE=%DOCKER_USERNAME%/panel-envanter:%TAG%

echo Building %IMAGE% ...
docker build -t %IMAGE% .

echo Pushing %IMAGE% ...
docker push %IMAGE%

echo Done. Image pushed: %IMAGE%
