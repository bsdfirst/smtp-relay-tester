#!/bin/sh

docker run --rm -it --network host -v "$(pwd)/smtp-test.js:/smtp-test.js:ro" node:22-alpine \
  node /smtp-test.js "$@"
