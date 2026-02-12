#!/usr/bin/env bash
# Build and push Panel Envanter image to Docker Hub.
# Usage: ./scripts/docker-publish.sh [TAG]
# Example: DOCKER_USERNAME=myuser ./scripts/docker-publish.sh v1.0.0
# Override with DOCKER_USERNAME env if needed.

set -e
TAG="${1:-latest}"
DOCKER_USERNAME="${DOCKER_USERNAME:-ariotiot}"
IMAGE="${DOCKER_USERNAME}/panel-envanter:${TAG}"

echo "Building ${IMAGE} ..."
docker build -t "${IMAGE}" .

echo "Pushing ${IMAGE} ..."
docker push "${IMAGE}"

echo "Done. Image pushed: ${IMAGE}"
