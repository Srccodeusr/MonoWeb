# MonoPanel VPS ROM: the image every MonoVPS container is created from.
# Built by the daemon (src/runtime-docker.js) with:  docker build -f rom/Dockerfile --build-arg BASE=<os image> rom/
# Debian/Ubuntu family only (apt). Everything below is baked into the image, so a new VPS has it on first login.
ARG BASE=ubuntu:22.04
FROM ${BASE}

ARG NODE_MAJOR=22
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

LABEL monovps.rom="1"

# 1) Base system: sshd, sudo and the everyday tools people expect on a fresh VPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server sudo curl ca-certificates wget gnupg lsb-release apt-transport-https \
      nano vim git procps iproute2 iputils-ping util-linux net-tools locales findutils \
      htop tmux screen unzip zip tar xz-utils bzip2 jq rsync openssl cron dnsutils traceroute lsof ncdu bash-completion \
      build-essential make g++ python3 python3-pip iptables \
 && mkdir -p /run/sshd /etc/ssh/sshd_config.d \
 && printf 'PermitRootLogin yes\nPasswordAuthentication yes\nUsePAM yes\n' > /etc/ssh/sshd_config.d/00-monovps.conf \
 && sed -i -E 's/^#*[[:space:]]*PermitRootLogin.*/PermitRootLogin yes/; s/^#*[[:space:]]*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
 && rm -rf /var/lib/apt/lists/*

# 2) Docker Engine (+ compose and buildx). Falls back to the distro's docker.io when Docker's own repo has no packages for this release.
#    The daemon is started by mono-init at boot; it only works when the node runs VPSes with sysbox-runc or VPS_PRIVILEGED=true.
RUN set -eux; . /etc/os-release; \
    install -m 0755 -d /etc/apt/keyrings; \
    if curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc; then \
      chmod a+r /etc/apt/keyrings/docker.asc; \
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list; \
    fi; \
    apt-get update; \
    ( apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin ) \
      || ( rm -f /etc/apt/sources.list.d/docker.list; apt-get update; apt-get install -y --no-install-recommends docker.io ); \
    rm -rf /var/lib/apt/lists/*; \
    docker --version

# 3) Node.js (NodeSource, falls back to 20.x if the requested major has no build for this OS) + pm2.
RUN set -eux; \
    ( curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - && apt-get install -y nodejs ) \
      || ( curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs ); \
    npm install -g pm2; \
    (corepack enable || true); \
    rm -rf /var/lib/apt/lists/* /root/.npm; \
    node --version; npm --version; pm2 --version

# 4) MonoPanel files: boot script, the ptreodoctyl-install menu, login hint. Kept last so editing them does not rebuild the layers above.
COPY rootfs/ /
RUN chmod 0755 /usr/local/sbin/mono-init /usr/local/bin/ptreodoctyl-install \
 && ln -sf ptreodoctyl-install /usr/local/bin/pterodactyl-install \
 && mkdir -p /etc/mono /var/log/mono

CMD ["/usr/local/sbin/mono-init"]
