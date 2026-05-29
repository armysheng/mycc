FROM ubuntu:22.04

ARG CODE_SERVER_VERSION=4.100.3
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
  bash \
  build-essential \
  ca-certificates \
  curl \
  dumb-init \
  git \
  gnupg \
  jq \
  pkg-config \
  procps \
  python3 \
  python3-pip \
  ripgrep \
  unzip \
  xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh \
  && bash /tmp/nodesource_setup.sh \
  && apt-get update \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/* /tmp/nodesource_setup.sh

RUN curl -fsSL https://code-server.dev/install.sh \
  | sh -s -- --method=standalone --prefix=/usr/local --version ${CODE_SERVER_VERSION}

RUN npm install -g @anthropic-ai/claude-code

RUN mkdir -p /opt/mycc-agent-runtime \
  && cd /opt/mycc-agent-runtime \
  && npm init -y \
  && npm install @anthropic-ai/claude-agent-sdk

COPY agent-sdk-bridge.mjs /opt/mycc-agent-runtime/bridge.mjs

RUN useradd -m -s /bin/bash mycc \
  && mkdir -p /home/mycc/workspace /home/mycc/.mycc \
  && chown -R mycc:mycc /home/mycc /opt/mycc-agent-runtime

USER mycc
WORKDIR /home/mycc/workspace
