FROM mcr.microsoft.com/devcontainers/base:ubuntu26.04

# Root-level setup: system packages, Node itself
RUN apt-get update && apt-get install -y curl git \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash \
    && apt-get install -y nodejs

# Switch to the non-root vscode user for everything user-scoped
USER vscode
WORKDIR /home/vscode

# Configure npm to install global packages to the user's home,
# avoiding permission errors and keeping installs user-owned
ENV NPM_CONFIG_PREFIX=/home/vscode/.npm-global
ENV PATH=/home/vscode/.npm-global/bin:/home/vscode/.local/bin:$PATH

# Install OpenCode
RUN curl -fsSL https://opencode.ai/install | bash

# Install neccsary npm packages
RUN npm install -g pnpm open-codebase-index
