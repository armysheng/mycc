FROM mcr.microsoft.com/playwright/python:v1.60.0-noble

ARG CODE_SERVER_VERSION=4.106.3
ARG CLAUDE_CODE_VERSION=2.1.158
ARG CLAUDE_AGENT_SDK_VERSION=0.3.158
ARG CLAUDE_CODE_ROUTER_VERSION=2.0.0
ARG BROWSER_USE_VERSION=0.12.9
ARG PLAYWRIGHT_VERSION=1.60.0

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV MYCC_BROWSER_AGENT_VENV=/opt/mycc/browser-agent/venv
ENV PATH=/opt/mycc/browser-agent/venv/bin:/opt/mycc/bin:${PATH}

RUN apt-get update && apt-get install -y \
  bash \
  build-essential \
  ca-certificates \
  coreutils \
  curl \
  dbus-x11 \
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
  novnc \
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
  websockify \
  wget \
  x11-utils \
  x11vnc \
  xdotool \
  xfce4 \
  xvfb \
  xz-utils \
  zip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh \
  && bash /tmp/nodesource_setup.sh \
  && apt-get update \
  && apt-get install -y nodejs \
  && corepack enable \
  && rm -rf /var/lib/apt/lists/* /tmp/nodesource_setup.sh

RUN curl -fsSL https://code-server.dev/install.sh \
  | sh -s -- --method=standalone --prefix=/usr/local --version ${CODE_SERVER_VERSION}

RUN npm install -g \
  @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
  @musistudio/claude-code-router@${CLAUDE_CODE_ROUTER_VERSION}

RUN mkdir -p /opt/mycc-agent-runtime \
  && cd /opt/mycc-agent-runtime \
  && npm init -y \
  && npm install @anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION}

RUN python3 -m venv "${MYCC_BROWSER_AGENT_VENV}" \
  && "${MYCC_BROWSER_AGENT_VENV}/bin/python" -m pip install --no-cache-dir --upgrade pip setuptools wheel uv \
  && "${MYCC_BROWSER_AGENT_VENV}/bin/python" -m pip install --no-cache-dir \
    browser-use==${BROWSER_USE_VERSION} \
    playwright==${PLAYWRIGHT_VERSION} \
  && "${MYCC_BROWSER_AGENT_VENV}/bin/python" -m playwright install chromium \
  && ln -sf "${MYCC_BROWSER_AGENT_VENV}/bin/uv" /usr/local/bin/uv

RUN chromium_bin="$(find /ms-playwright -type f -name chrome -o -type f -name headless_shell | head -n 1)" \
  && test -n "$chromium_bin" \
  && ln -sf "$chromium_bin" /usr/local/bin/chromium

COPY scripts/agent-sdk-bridge.mjs /opt/mycc-agent-runtime/bridge.mjs
COPY contracts/template-contract.sh /opt/mycc/contracts/template-contract.sh
COPY bin/mycc-start-code-server /usr/local/bin/mycc-start-code-server
COPY bin/mycc-start-ccr /usr/local/bin/mycc-start-ccr
COPY bin/mycc-start-desktop /usr/local/bin/mycc-start-desktop
COPY bin/mycc-health-desktop /usr/local/bin/mycc-health-desktop
COPY bin/mycc-register-deliverable /usr/local/bin/mycc-register-deliverable
COPY skills /opt/mycc/skills

RUN useradd -m -s /bin/bash mycc \
  && mkdir -p /home/mycc/workspace /home/mycc/.mycc /home/mycc/.claude /home/mycc/.cache /opt/mycc/bin \
  && ln -sfn /ms-playwright /home/mycc/.cache/ms-playwright \
  && cp -R /opt/mycc/skills /home/mycc/.mycc/skills \
  && cp -R /opt/mycc/skills /home/mycc/.claude/skills \
  && chmod +x \
    /opt/mycc/contracts/template-contract.sh \
    /usr/local/bin/mycc-start-code-server \
    /usr/local/bin/mycc-start-ccr \
    /usr/local/bin/mycc-start-desktop \
    /usr/local/bin/mycc-health-desktop \
    /usr/local/bin/mycc-register-deliverable \
  && chown -R mycc:mycc /home/mycc /opt/mycc /opt/mycc-agent-runtime

USER mycc
WORKDIR /home/mycc/workspace
