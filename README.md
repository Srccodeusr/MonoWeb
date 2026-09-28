<div align="center">

# MonoWeb

**The website, billing system and admin panel behind MonoNode — Discord Bot Hosting & VPS Hosting.**

Black & white. Fast. Built to be run and edited by the people who host on it.

![License](https://img.shields.io/badge/license-MIT-white?style=flat-square&labelColor=000000)
![React](https://img.shields.io/badge/React-19-white?style=flat-square&labelColor=000000)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-white?style=flat-square&labelColor=000000)
![Tailwind](https://img.shields.io/badge/Tailwind-4-white?style=flat-square&labelColor=000000)
![PRs](https://img.shields.io/badge/PRs-welcome-white?style=flat-square&labelColor=000000)

</div>

---

## What is MonoWeb?

MonoWeb is the full-stack web platform for **MonoNode**. It gives you a public marketing site, customer accounts, a billing and order system, a support desk, an in-dashboard mail inbox, and a complete admin panel — all in one repo, with no external database to set up.

It sells exactly two products:

- **Discord Bot Hosting**
- **VPS Hosting**

MonoWeb started from the open-source AetherPanel codebase by Ym0T (MIT licensed). It has since been re-themed, re-branded and extended, and it no longer includes any game-server management. It is the *website and billing side* of a hosting business, not a server control panel.

---

## Features

### Public website
- Fully redesigned **black & white home page** with a ticker, product cards, infrastructure section, stats and FAQ
- Product cards pull their **prices and feature lists from your real plans**, so the site never drifts out of sync with what you sell
- Dedicated **Bot Hosting**, **VPS Hosting** and **Pricing** pages
- **Status page** with incident tracking and scheduled maintenance
- **Docs** page and editable **legal pages** (Terms, Privacy, etc.)

### Accounts & authentication
- Email + password sign-up and login
- **Google** sign-in (via Firebase) and **Discord** OAuth — both optional
- Role system: `user`, `support`, `moderator`, `admin`, `super_admin`
- JWT sessions, hashed passwords, API rate limiting and a CORS allow-list
- Optional VPN/proxy blocking to reduce abuse

### Customer dashboard
- Account overview, **Billing**, **Checkout**, **Support Tickets**, **Mail**, **Activity Log** and **Settings**
- Account credits, order history and **coupon** redemption
- Link a Discord account and configure webhooks
- **Quick Links** in the sidebar — one-click shortcuts to whatever you choose (see below)

### Billing
- Pay with **UPI, bank transfer, crypto or gift cards**
- Every manual payment is **verified by staff before credits are added**, so nothing is granted on trust
- Coupons, orders and pending approvals managed from the admin panel
- Instant card payments are **not** available — the Stripe toggle exists as a placeholder only and is blocked server-side until a real processor is integrated

### Mail
A built-in inbox so you can message customers without leaving the platform.
- Staff (`support`, `moderator`, `admin`, `super_admin`) can send a message to **one user** or **broadcast to everyone**
- Customers get an inbox with an **unread counter**, mark-all-read and delete
- Admins see every sent message with **read receipts** (e.g. `12/40 read`), grouped per broadcast

### Panel Link & Quick Links
- Admin → **Panel Link** lets you add, edit and remove **Quick Links** (label + URL, up to 12) — for example a Discord bot panel, a VPS panel or a status page
- Links that have a URL appear in every customer's dashboard sidebar and open in a new tab
- Optional **auto-provisioning** (Pterodactyl / Pelican-compatible panel via API) is still available under *Advanced*, and is off by default

### Themes & fonts
- Ships with the **MonoNode Black & White** theme as the default
- **Chakra Petch** for headings and the logo, **Quicksand** for body text
- Switch themes and fonts from Admin → **Appearance**

### Admin panel
System overview · Users · Products & Plans · Orders & Billing · Coupons · Announcements · Ad campaigns · Discord integration · Appearance · Support queue · Mail · Audit trail · REST API keys · Legal & policies · Platform settings · Panel Link

### Discord integration
- Account linking and account/billing notifications through a Discord bot and webhooks (optional)

---

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, Motion, Lucide icons |
| Backend | Node.js, Express 4, TypeScript (run with `tsx`) |
| Storage | Local JSON file database (`data/db.json`) — no database server needed |
| Auth | JSON Web Tokens, bcryptjs, Firebase (Google sign-in), Discord OAuth2 |
| Integrations | discord.js 14 |

---

## Getting started

### Requirements
- **Node.js 18 or newer**
- npm

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/MonoWeb.git
cd MonoWeb
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Open `.env` and set at least these three values **before the first start**:

```env
JWT_SECRET="a-long-random-string"
AETHER_ADMIN_EMAIL="you@yourdomain.com"
AETHER_ADMIN_PASSWORD="a-strong-password"
```

> **Important:** if `AETHER_ADMIN_EMAIL` / `AETHER_ADMIN_PASSWORD` are not set, the first-run admin account falls back to built-in default credentials. Always set your own.

### 3. Run in development

```bash
npm run dev
```

Open **http://localhost:3000** and sign in with the admin account from your `.env`.

### 4. Build and run in production

```bash
npm run build
npm start
```

The server listens on port **3000**. Put it behind a reverse proxy (Nginx, Caddy, etc.) for HTTPS, and set `APP_URL` and `ALLOWED_ORIGINS` to your public domain.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API and the Vite dev server together |
| `npm run build` | Builds the frontend and bundles the server into `dist/` |
| `npm start` | Runs the production build |
| `npm run lint` | Type-checks the whole project (`tsc --noEmit`) |
| `npm run clean` | Removes build output |

---

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Secret used to sign login tokens. Use a long random value. |
| `AETHER_ADMIN_EMAIL` | Yes | Email of the first super admin created on first start. |
| `AETHER_ADMIN_PASSWORD` | Yes | Password of the first super admin. |
| `AETHER_INSTALLATION_ID` / `AETHER_INSTALLATION_SECRET` | No | Identity keys for this installation. |
| `APP_URL` | Yes (prod) | Public URL of your site, used for OAuth callbacks. |
| `ALLOWED_ORIGINS` | Yes (prod) | Comma-separated list of allowed CORS origins. |
| `TRUST_PROXY` | No | Set to `false` if you are not behind a reverse proxy. |
| `VPN_CHECK_API_KEY` | No | Key for the VPN/proxy detection provider. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` | No | Enables Discord OAuth login. |
| `DISCORD_BOT_TOKEN` | No | Enables the Discord bot integration. |
| `VITE_FIREBASE_*` | No | Firebase web-app credentials for Google sign-in. |
| `NODE_ENV` | No | `development` or `production`. |

---

## Project structure

```text
MonoWeb/
├── server.ts                # Express entry point (API + Vite middleware)
├── server/
│   ├── db.ts                # JSON database, defaults and migrations
│   ├── auth.ts              # Auth middleware and role checks
│   ├── discordService.ts    # Discord bot
│   ├── webhookService.ts    # Outgoing webhooks
│   └── routes/              # admin, auth, billing, mail, support, status, public, ...
├── src/
│   ├── App.tsx              # Page routing and layout
│   ├── index.css            # Theme tokens: fonts and the black & white colour ramp
│   ├── types.ts             # Shared TypeScript types
│   ├── components/          # Navbar, Footer, Sidebar, logo, ...
│   ├── lib/                 # Theme, branding and auth contexts, API helper
│   └── pages/
│       ├── public/          # Home, Bot Hosting, VPS Hosting, Pricing, Status, Docs
│       ├── auth/            # Login, Register
│       ├── customer/        # Dashboard, Billing, Checkout, Mail, Tickets, Settings
│       └── admin/           # Every admin page
├── public/                  # Logos and favicon
└── data/                    # Runtime data (db.json) — never committed
```

The API lives under `/api/v1/` (`auth`, `billing`, `support`, `mail`, `admin`, `public`, `discord`, `status`, `api-keys`, `ads`).

---

## Data & backups

All data is stored in `data/db.json`, which is created on first start and is git-ignored. **Back this file up regularly** — it holds your users, orders and settings. Never commit it or your `.env`.

---

## Contributing

Contributions are very welcome! Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the fork-and-pull-request guide.

---

## License

Released under the **MIT License** — see [LICENSE](LICENSE).

MonoWeb is built on the open-source AetherPanel project; the original copyright notice is preserved in the license file as the MIT License requires.
