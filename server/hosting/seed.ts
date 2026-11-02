import { Addon, HostImage, StoreItem } from '../../src/hostingTypes';

const now = () => new Date().toISOString();

const NODE_INSTALL = `#!/bin/bash
cd /mnt/server
if [ "$USER_UPLOAD" = "1" ]; then echo "User upload mode: skipping the install step"; echo "Install complete"; exit 0; fi
if [ -n "$GIT_ADDRESS" ]; then
  apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq git >/dev/null 2>&1
  URL="$GIT_ADDRESS"
  if [ -n "$USERNAME" ] && [ -n "$ACCESS_TOKEN" ]; then URL="https://\${USERNAME}:\${ACCESS_TOKEN}@\${GIT_ADDRESS#https://}"; fi
  BR=""; [ -n "$BRANCH" ] && BR="--branch $BRANCH"
  [ -d .git ] && git pull || git clone $BR "$URL" .
fi
if [ ! -f package.json ]; then
  echo '{"name":"app","version":"1.0.0","main":"index.js"}' > package.json
  echo 'require("http").createServer((q,r)=>r.end("Hello from MonoNode!")).listen(process.env.SERVER_PORT||3000);console.log("Listening on",process.env.SERVER_PORT||3000)' > index.js
fi
echo "Install complete"`;

/** Same variables and startup flow as the generic Node.js egg on Pterodactyl panels (POSIX sh: the daemon runs startup with /bin/sh -c). */
export const NODE_STARTUP = [
  'if [ "${USER_UPLOAD}" != "1" ] && [ -n "${GIT_ADDRESS}" ]; then',
  '  if [ -n "${USERNAME}" ] && [ -n "${ACCESS_TOKEN}" ]; then GIT_URL="https://${USERNAME}:${ACCESS_TOKEN}@${GIT_ADDRESS#https://}"; else GIT_URL="${GIT_ADDRESS}"; fi;',
  '  BR=""; [ -n "${BRANCH}" ] && BR="--branch ${BRANCH}";',
  '  if [ ! -d .git ]; then git clone ${BR} "${GIT_URL}" .panel_clone && cp -a .panel_clone/. . && rm -rf .panel_clone;',
  '  elif [ "${AUTO_UPDATE}" = "1" ]; then git pull; fi;',
  'fi;',
  '[ -n "${UNNODE_PACKAGES}" ] && npm uninstall ${UNNODE_PACKAGES};',
  '[ -n "${NODE_PACKAGES}" ] && npm install ${NODE_PACKAGES};',
  '[ -f ./package.json ] && npm install --omit=dev --no-audit --no-fund;',
  'if [ -n "${MAIN_FILE}" ]; then node ./${MAIN_FILE} ${NODE_ARGS}; else echo "MAIN_FILE is not set. Skipping execution."; fi',
].join(' ');

const NODE_VARIABLES = (): HostImage['variables'] => [
  { name: 'Git Repo Address', env: 'GIT_ADDRESS', default: '', description: 'GitHub repo to clone, e.g. https://github.com/user/repo_name', userEditable: true, rules: '/^(https:\\/\\/[^\\s]{3,200})?$/' },
  { name: 'Install Branch', env: 'BRANCH', default: '', description: 'The branch to install.', userEditable: true, rules: '/^[A-Za-z0-9_.\\/-]{0,100}$/' },
  { name: 'User Uploaded Files', env: 'USER_UPLOAD', default: '0', description: 'Skip all the install stuff if you are letting a user upload files. 0 = false (default), 1 = true', userEditable: true, rules: 'boolean' },
  { name: 'Auto Update', env: 'AUTO_UPDATE', default: '0', description: 'Pull the latest files on startup when using a GitHub repo.', userEditable: true, rules: 'boolean' },
  { name: 'Additional Node packages', env: 'NODE_PACKAGES', default: '', description: 'Install additional node packages. Use spaces to separate.', userEditable: true, rules: '/^[A-Za-z0-9@\\/._~^<>=* -]{0,300}$/' },
  { name: 'Git Username', env: 'USERNAME', default: '', description: 'Username to auth with git.', userEditable: true, rules: '/^[A-Za-z0-9_.@-]{0,100}$/' },
  { name: 'Uninstall Node packages', env: 'UNNODE_PACKAGES', default: '', description: 'Uninstall node packages. Use spaces to separate.', userEditable: true, rules: '/^[A-Za-z0-9@\\/._~^<>=* -]{0,300}$/' },
  { name: 'Git Access Token', env: 'ACCESS_TOKEN', default: '', description: 'Password to use with git. It is best practice to use a Personal Access Token (github.com/settings/tokens).', userEditable: true, rules: '/^[A-Za-z0-9_.-]{0,200}$/' },
  { name: 'Main file', env: 'MAIN_FILE', default: 'index.js', description: 'The file that starts the app. Can be .js and .ts', userEditable: true, rules: '/^[A-Za-z0-9_./-]{0,100}$/' },
  { name: 'Additional Arguments', env: 'NODE_ARGS', default: '', description: 'Any extra arguments for nodejs or ts-node', userEditable: true, rules: '/^[A-Za-z0-9_=.\\/ :,@-]{0,200}$/' },
];
const NODE_DOCKER_IMAGES: Record<string, string> = {
  'Node.js 25': 'ghcr.io/pterodactyl/yolks:nodejs_25', 'Node.js 24': 'ghcr.io/pterodactyl/yolks:nodejs_24',
  'Node.js 22': 'ghcr.io/pterodactyl/yolks:nodejs_22', 'Node.js 20': 'ghcr.io/pterodactyl/yolks:nodejs_20',
};

/**
 * One-time upgrade for databases created before the Startup tab existed: the untouched default Node.js software gets the
 * full variable set + startup flow. Anything an admin already edited (startup text or more than the 2 original variables) is left alone.
 */
export function upgradeLegacyNodeImage(img: HostImage): boolean {
  const legacyStartup = 'if [ -f package.json ]; then npm install --omit=dev --no-audit --no-fund; fi; node {{MAIN_FILE}}';
  if (img.id !== 'img_nodejs' || img.startup !== legacyStartup || img.variables.some(v => v.env === 'BRANCH')) return false;
  img.startup = NODE_STARTUP;
  img.variables = NODE_VARIABLES();
  img.dockerImages = { ...NODE_DOCKER_IMAGES, ...img.dockerImages };
  img.install.script = NODE_INSTALL;
  return true;
}

const PY_INSTALL = `#!/bin/bash
cd /mnt/server
if [ -n "$GIT_ADDRESS" ]; then
  apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq git >/dev/null 2>&1
  [ -d .git ] && git pull || git clone "$GIT_ADDRESS" .
fi
[ -f main.py ] || echo 'print("Hello from MonoNode!")
import time
while True: time.sleep(60)' > main.py
echo "Install complete"`;

const STATIC_INSTALL = `#!/bin/bash
cd /mnt/server
mkdir -p public
[ -f public/index.html ] || echo '<h1>Your site is live on MonoNode</h1>' > public/index.html
echo "Install complete"`;

const base = { iconUrl: '', isActive: true, minRamMB: 128, createdAt: '' };

export function defaultImages(): HostImage[] {
  const t = now();
  return [
    {
      ...base, createdAt: t, id: 'img_nodejs', name: 'Node.js', software: 'Node.js', category: 'Coding Languages',
      description: 'Run any Node.js app, bot or API. Git deploys, extra packages and a main file are set in the Startup tab.',
      dockerImages: { ...NODE_DOCKER_IMAGES }, defaultImage: 'Node.js 22',
      startup: NODE_STARTUP, stopCommand: '^C',
      ports: [{ label: 'App', container: 3000, proto: 'tcp' }],
      variables: NODE_VARIABLES(),
      install: { image: 'ghcr.io/pterodactyl/installers:debian', entrypoint: 'bash', script: NODE_INSTALL, files: [] }, runtime: 'any',
    },
    {
      ...base, createdAt: t, id: 'img_python', name: 'Python', software: 'Python', category: 'Coding Languages',
      description: 'Python scripts, Discord/Telegram bots and web apps.',
      dockerImages: { 'Python 3.12': 'ghcr.io/pterodactyl/yolks:python_3.12', 'Python 3.11': 'ghcr.io/pterodactyl/yolks:python_3.11' }, defaultImage: 'Python 3.12',
      startup: 'if [ -f requirements.txt ]; then pip install -U --prefix .local -r requirements.txt; fi; python {{MAIN_FILE}}', stopCommand: '^C',
      ports: [{ label: 'App', container: 8000, proto: 'tcp' }],
      variables: [
        { name: 'Main file', env: 'MAIN_FILE', default: 'main.py', description: 'File to run.', userEditable: true, rules: '/^[A-Za-z0-9_./-]{1,100}$/' },
        { name: 'Git repository', env: 'GIT_ADDRESS', default: '', description: 'Optional public git URL cloned on install.', userEditable: true, rules: '/^(https:\\/\\/[^\\s]{3,200})?$/' },
      ],
      install: { image: 'ghcr.io/pterodactyl/installers:debian', entrypoint: 'bash', script: PY_INSTALL, files: [] }, runtime: 'any',
    },
    {
      ...base, createdAt: t, id: 'img_static', name: 'Static Website', software: 'Static Site (Python http.server)', category: 'Websites',
      description: 'Serve HTML/CSS/JS from the public/ folder.',
      dockerImages: { Python: 'ghcr.io/pterodactyl/yolks:python_3.12' }, defaultImage: 'Python',
      startup: 'cd public && python -m http.server {{SERVER_PORT}}', stopCommand: '^C',
      ports: [{ label: 'HTTP', container: 8080, proto: 'tcp' }], variables: [],
      install: { image: 'ghcr.io/pterodactyl/installers:debian', entrypoint: 'bash', script: STATIC_INSTALL, files: [] }, runtime: 'any',
    },
    {
      ...base, createdAt: t, id: 'img_minecraft', name: 'Minecraft (Paper)', software: 'Minecraft Paper', category: 'Games', minRamMB: 1024,
      description: 'Paper Minecraft server. Needs at least 1 GB RAM.',
      dockerImages: { 'Java 21': 'ghcr.io/pterodactyl/yolks:java_21' }, defaultImage: 'Java 21',
      startup: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui', stopCommand: 'stop',
      ports: [{ label: 'Game', container: 25565, proto: 'tcp' }],
      variables: [{ name: 'Minecraft version', env: 'MC_VERSION', default: '1.21.4', description: 'Paper version to download.', userEditable: true, rules: '/^[0-9.]{3,10}$/' }],
      install: {
        image: 'ghcr.io/pterodactyl/installers:alpine', entrypoint: 'ash', files: [],
        script: `cd /mnt/server\napk add --no-cache curl jq >/dev/null\nB=$(curl -s https://api.papermc.io/v2/projects/paper/versions/$MC_VERSION/builds | jq -r '.builds[-1].build')\ncurl -fsSL -o server.jar https://api.papermc.io/v2/projects/paper/versions/$MC_VERSION/builds/$B/downloads/paper-$MC_VERSION-$B.jar\necho "eula=true" > eula.txt\necho "Install complete"`,
      },
      runtime: 'container',
    },
  ];
}

export function defaultStoreItems(): StoreItem[] {
  const t = now();
  const b = { isActive: true, stock: 0, perUserLimit: 0, sold: 0, createdAt: t, iconUrl: '', priceMoney: 0 };
  return [
    { ...b, id: 'store_ram', type: 'spec_upgrade', name: '+256 MB RAM (7 days)', description: 'Boost one server with extra memory for a week.', priceCoins: 150, sortOrder: 1, upgrade: { ramMB: 256, cpuPercent: 0, diskMB: 0, durationDays: 7, maxPerServer: 4 } },
    { ...b, id: 'store_cpu', type: 'spec_upgrade', name: '+25% CPU (7 days)', description: 'More CPU headroom for one server.', priceCoins: 120, sortOrder: 2, upgrade: { ramMB: 0, cpuPercent: 25, diskMB: 0, durationDays: 7, maxPerServer: 4 } },
    { ...b, id: 'store_disk', type: 'spec_upgrade', name: '+512 MB storage (permanent)', description: 'Permanent extra disk space for one server.', priceCoins: 300, sortOrder: 3, upgrade: { ramMB: 0, cpuPercent: 0, diskMB: 512, durationDays: 0, maxPerServer: 4 } },
    { ...b, id: 'store_renew', type: 'renew', name: 'Renew a server (+7 days)', description: 'Extend one server by a week. Only available while "renew with coins" is enabled.', priceCoins: 100, sortOrder: 4, renewDays: 7 },
    { ...b, id: 'store_premium3', type: 'temp_premium', name: 'Premium for 3 days', description: 'Try Premium perks: no ads, bigger limits.', priceCoins: 500, sortOrder: 5, premiumPlanId: 'plan_premium', premiumDays: 3 },
    { ...b, id: 'store_slot', type: 'slot', name: '+1 server slot', description: 'Permanently raise your server limit by one.', priceCoins: 1500, sortOrder: 6, slots: 1 },
    { ...b, id: 'store_pack', type: 'server_pack', name: 'Boosted server (2 GB, 30 days)', description: 'One extra server with better specs than your plan.', priceCoins: 2500, sortOrder: 7, pack: { ramMB: 2048, cpuPercent: 150, diskMB: 4096, swapMB: 0, backups: 2, databases: 1, validityDays: 30 } },
  ];
}

/**
 * Example addons. They ship DISABLED because they point at placeholder URLs: edit the file URLs in
 * Admin > Addon Store, then enable them. (Real, version-pinned download links are yours to choose.)
 */
export function defaultAddons(): Addon[] {
  const t = now();
  const base = { iconUrl: '', author: 'MonoNode', version: '1.0.0', priceCoins: 0, priceMoney: 0, isActive: false, featured: false, restartAfter: false, installs: 0, createdAt: t, updatedAt: t };
  return [
    { ...base, id: 'addon_example_plugin', name: 'Example plugin (edit me)', slug: 'example-plugin', category: 'Plugins', description: 'Downloads a plugin jar into plugins/. Replace the URL with your own, then enable this addon.', compatibleImageIds: ['img_minecraft'], files: [{ url: 'https://example.com/plugin.jar', path: '/plugins/plugin.jar', extract: false }], postCommand: 'reload', restartAfter: false },
    { ...base, id: 'addon_example_template', name: 'Starter template (edit me)', slug: 'starter-template', category: 'Templates', description: 'Downloads and unpacks a zip archive of starter files into the server root.', compatibleImageIds: ['img_nodejs', 'img_python'], files: [{ url: 'https://example.com/starter.zip', path: '/starter.zip', extract: true }], restartAfter: true },
  ];
}
