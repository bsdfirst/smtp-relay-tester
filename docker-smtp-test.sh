#!/bin/sh

docker run --rm -it -v "$(pwd)/smtp-test.js:/smtp-test.js:ro" node:22-alpine \
  node /smtp-test.js "$@"
