#!/bin/bash -e
# https://gist.github.com/alexander-g/e9e1db0b92c468a9681c473a9108a136

BASE_DIR=$(realpath `dirname "$BASH_SOURCE"`)
export DENO_DIR=$BASE_DIR/.deno
export DENO_PATH=$DENO_DIR/deno
export PATH=$DENO_DIR:$PATH
export DENO_NO_UPDATE_CHECK=1
export DENO_NO_PROMPT=1
export HTTPS_PROXY=$DENO_HTTPS_PROXY

if ! [ -e $DENO_PATH ];
then
    echo "Downloading deno..."
    wget  https://github.com/denoland/deno/releases/download/v2.4.4/deno-x86_64-unknown-linux-gnu.zip  -O ./deno.zip -nv
    unzip ./deno.zip -d $DENO_DIR  && rm ./deno.zip
    echo "*" > $DENO_DIR/.gitignore
fi

DENO_DIR=$DENO_DIR $DENO_PATH $@

