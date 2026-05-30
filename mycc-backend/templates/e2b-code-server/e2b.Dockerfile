FROM ubuntu:22.04

ARG CODE_SERVER_VERSION=4.106.3
ARG CLAUDE_CODE_VERSION=2.1.158
ARG CLAUDE_AGENT_SDK_VERSION=0.3.158
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
  bash \
  build-essential \
  ca-certificates \
  coreutils \
  curl \
  dumb-init \
  file \
  findutils \
  gawk \
  git \
  gnupg \
  grep \
  gzip \
  jq \
  less \
  lsof \
  make \
  nano \
  net-tools \
  openssh-client \
  pkg-config \
  procps \
  python3 \
  python3-pip \
  python3-venv \
  ripgrep \
  sed \
  tar \
  tree \
  unzip \
  vim \
  xz-utils \
  zip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh \
  && bash /tmp/nodesource_setup.sh \
  && apt-get update \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/* /tmp/nodesource_setup.sh

RUN curl -fsSL https://code-server.dev/install.sh \
  | sh -s -- --method=standalone --prefix=/usr/local --version ${CODE_SERVER_VERSION}

RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

RUN mkdir -p /opt/mycc-agent-runtime \
  && cd /opt/mycc-agent-runtime \
  && npm init -y \
  && npm install @anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION}

COPY agent-sdk-bridge.mjs /opt/mycc-agent-runtime/bridge.mjs

RUN useradd -m -s /bin/bash mycc \
  && mkdir -p /home/mycc/workspace /home/mycc/.mycc \
  && chown -R mycc:mycc /home/mycc /opt/mycc-agent-runtime

USER mycc
WORKDIR /home/mycc/workspace
