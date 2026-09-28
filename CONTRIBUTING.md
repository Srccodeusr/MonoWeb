# Contributing to MonoWeb

Thanks for wanting to help improve MonoWeb! Whether it's a typo, a bug fix or a whole new feature, every contribution is appreciated.

This guide walks you through the whole process: **fork → clone → `future` branch → make your change → pull request.**

---

## The workflow at a glance

1. **Fork** the repository to your own GitHub account
2. **Clone** your fork to your computer
3. Create a branch named **`future`** in your fork
4. Make your fix or feature on that branch
5. Test it (`npm run lint`, `npm run dev`, `npm run build`)
6. **Push** the `future` branch to your fork
7. Open a **pull request** to request that your changes be merged

---

## Step 1 — Fork the repository

Click the **Fork** button at the top right of the MonoWeb repository page on GitHub. This creates your own copy under your account.

## Step 2 — Clone your fork

```bash
git clone https://github.com/<your-username>/MonoWeb.git
cd MonoWeb
```

Add the original repository as `upstream` so you can stay up to date with it:

```bash
git remote add upstream https://github.com/<owner>/MonoWeb.git
```

## Step 3 — Create the `future` branch

Never work directly on `main`. All your work goes on a branch named **`future`**:

```bash
git checkout -b future
```

## Step 4 — Set up the project

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `JWT_SECRET`, `AETHER_ADMIN_EMAIL` and `AETHER_ADMIN_PASSWORD` (see the README for details), then start the dev server:

```bash
npm run dev
```

Open http://localhost:3000 and sign in with your admin account.

## Step 5 — Make your changes

Fix the bug or build the feature on your `future` branch. Commit as you go with clear messages:

```bash
git add .
git commit -m "Fix: mail broadcast count shows wrong total"
```

Good commit messages start with a short prefix such as `Fix:`, `Add:`, `Update:`, `Docs:` or `Refactor:`.

## Step 6 — Test before you submit

MonoWeb has no automated test suite yet, so please check your work by hand:

```bash
npm run lint     # type-check the whole project — must pass with no errors
npm run dev      # click through every page your change touches
npm run build    # the production build must succeed
```

If your change touches the frontend, check it on both a **desktop-width** and a **phone-width** window.

## Step 7 — Push and open a pull request

Push your branch to your fork:

```bash
git push origin future
```

Then go to your fork on GitHub. You'll see a **Compare & pull request** button — click it, and make sure:

- **base repository:** the original MonoWeb repository
- **base branch:** `main`
- **head repository:** your fork
- **compare branch:** `future`

Fill in the pull request template below and submit it. A maintainer will review it, may ask for changes, and will merge it when it's ready.

### Pull request description

Please include:

- **What** you changed and **why**
- **How to test it** (which page, which steps)
- **Screenshots** for anything visual (before and after)
- Any related issue, e.g. `Closes #12`

---

## Keeping your fork up to date

Before starting new work, sync with the original repository so you don't build on old code:

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
git checkout future
git merge main
```

If Git reports conflicts, fix them in the listed files, then `git add` them and `git commit`.

### Sending more than one change?

Your `future` branch is what a pull request is opened from, so **one pull request = one focused change**. Once your pull request has been merged, sync your fork (above) and keep using `future` for the next change. If you want to work on two unrelated things at once, create an extra branch for the second one (for example `future-login-fix`) and open a separate pull request from it.

---

## Project rules & tips

### Colours and theme
MonoWeb's look is **black and white**. To keep it that way:

- Use the neutral scale — `zinc-*`, `white` and `black` — for new UI.
- The `amber`, `yellow`, `orange`, `violet` and `cyan` colour names are deliberately **remapped to a black & white ramp** in `src/index.css`. They still work for icons and subtle tints, but avoid putting `text-white` on top of a `bg-amber-500` style background — the light half of that ramp is near-white, so the text would disappear.
- `emerald` (success) and `rose` (danger) keep their real colours on purpose. Use them only for meaning, not decoration.

### Fonts
- Headings use **Chakra Petch** (`font-display`), body text uses **Quicksand** (`font-sans`). Don't hardcode other font families in components.

### Code style
- TypeScript everywhere — avoid `any` unless there is no reasonable alternative.
- React function components with hooks; keep components focused and small.
- Follow the patterns already used in the file you are editing.
- Shared types belong in `src/types.ts`.

### Backend changes
- New API routes go in `server/routes/`; keep admin-only actions behind the existing role checks.
- Validate all input on the server — never trust the browser.
- If you add a new setting, add a default and a migration line in `server/db.ts` so existing installs keep working.
- Record important admin actions in the audit log like the existing routes do.

### Security — please read
- **Never commit** `.env`, `data/db.json`, API keys, tokens or real user data.
- Do not weaken authentication, role checks or rate limiting.
- Found a security vulnerability? **Please don't open a public issue.** Contact the maintainer privately instead so it can be fixed before it is disclosed.

---

## Reporting bugs & suggesting features

Open an **Issue** and include:

- What you expected to happen and what actually happened
- Steps to reproduce
- Screenshots or console errors if you have them
- Your Node.js version and browser

Feature ideas are welcome too — describe the problem you want solved before jumping into code, so we can agree on the approach first.

---

## Code of conduct

Be kind and respectful. Give constructive feedback, assume good intentions, and remember that everyone here is helping for free. Harassment or abuse of any kind is not tolerated.

---

Thank you for helping make MonoWeb better!
