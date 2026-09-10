# Wavelength

Wavelength is a browser-based multiplayer party game where a Psychic gives a clue and Guessers place a dial on a hidden target spectrum in real time.

## Demo

Live demo: _Add the published demo URL here when one exists._

Screenshot placeholders:

- `[Capture: lobby, room code, invite link, and player list]`
- `[Capture: Psychic role with pole labels, target zones, and clue controls]`
- `[Capture: Guesser role during the synchronized countdown with the target hidden]`
- `[Capture: target reveal, score banner, and updated player scores]`
- `[Capture: wide three-column Party / game / Chat layout]`

These placeholders are intentionally included for the public portfolio presentation. Replace them with the exact screenshots listed in the final project handoff.

## Key Features

- Room creation and invite-link joining with short room codes
- Ably-powered realtime presence and synchronized game-state updates
- Host-controlled lobby start followed by automatic inter-round countdowns and deterministic Psychic rotation
- Explicit synchronized waiting, Psychic-selection, starting, clue, guessing, reveal, and results phases
- Automatic hidden-target generation, a Psychic-only wheel-spin animation, customizable spectrum poles, and live clue entry
- Full-domain 0–100 targets with wrapped scoring bands and circular distance scoring across the 0/100 seam
- Role-specific dial controls, a configurable synchronized guessing countdown (5–60 seconds), early reveal when every eligible Guesser locks in, target reveal, and result feedback
- Host-only pre-game controls for guessing time, time between rounds, and the first Psychic (random or selected)
- A synchronized random-Psychic roulette with a one-second settled-result hold, a shorter selected-Psychic announcement, and Host pause/resume across active play and handoffs
- Per-round tiered result feedback, player score display, and host kick control
- A centered desktop game layout with compact Party and Chat sidebars, plus game-first responsive stacking on narrower screens
- Ephemeral, room-scoped realtime chat with authenticated sender identity, bounded messages, duplicate rejection, and a short send cooldown
- Safe DOM rendering for untrusted player names and bounded client-side input/state values
- Token-authentication integration point that keeps Ably credentials out of browser code
- Minimal Node.js local server that serves the game and signs room-scoped Ably TokenRequests

## How It Works / Technical Overview

The single-page client creates or joins a room from the URL, creates a cryptographically random identity in `sessionStorage`, requests a short-lived Ably token bound to that identity from `/api/ably-token`, connects to the room's Ably channel, and enters presence with a display name and score. The Host starts the game once from the lobby. The first Psychic is either chosen with a synchronized roulette or announced from the Host's manual selection; subsequent rounds advance automatically through the connected-player rotation. The selected Psychic owns the hidden target, clue transition, guessing countdown, reveal, and scoring, while the Host owns the inter-round countdown. The Canvas API draws the spectrum, wrapped target zones, spin animation, and role-appropriate dial needle from synchronized state. On wide screens, equal-width secondary rails keep the flexible game surface visually centered between Party and Chat; below the desktop breakpoint, the game appears first and both sidebars stack beneath it.

For local development, `server.mjs` uses Node's built-in HTTP server to serve the static files and the Ably Node SDK to sign a room-scoped TokenRequest. The server reads `ABLY_API_KEY` only from the local environment.

The Host snapshots connected participants and publishes a new round ID in the `selecting` phase for round one or `starting` for later rounds. The Psychic generates and locally caches an integer target anywhere from 0 through 100, animates it as presentation only, then advances through clue, guessing, reveal, and results. Scoring uses the shortest circular distance, so values near 0 and 100 are neighbors; the visual 3/2/1-point bands use the same 3/9/16-distance thresholds and split cleanly across the seam. The target is omitted from public state until reveal. Round IDs, monotonically increasing state versions, phase-transition checks, sender checks, and the participant snapshot reject stale or conflicting actions. Room-scoped session state supports same-tab reload recovery without publishing the hidden target.

Pause/resume is a synchronized Host action. It freezes the roulette deadline, Psychic target animation, guessing timer, result countdown, and cancelled-round handoff; resuming continues from the remaining time instead of restarting the phase. The guessing timer is a maximum: the Psychic moves directly to reveal once every connected Guesser in the round snapshot has locked a unique, round-scoped guess. An unsubmitted Guesser who disconnects receives the same eight-second reconnection grace used by the existing departure flow before being removed from that quorum. Players who arrive during a round are spectators until the next snapshot, and disconnected players are omitted when the next Psychic is chosen.

Successful connection is intentionally silent in the player UI. The status area appears only while connecting/reconnecting or when connection, authentication, input, or room-entry errors require attention; token authentication itself remains unchanged.

The player list is assembled with `textContent`, `createElement`, and event listeners. User-controlled usernames are never interpolated into HTML.

Chat reuses the authenticated room channel and adds no Ably capability. Each message is ephemeral and contains only its room ID, bounded text, timestamp, and random message ID. The receiver treats Ably's authenticated `message.clientId` as the sender, resolves the visible name from presence, rejects malformed, duplicate, oversized, stale, wrong-room, and unknown-player messages, and renders message text with `textContent`. A 750 ms client cooldown limits accidental send bursts. There is intentionally no chat history after a full reload.

## Technologies

- HTML, CSS, and browser JavaScript
- Tailwind CSS via the Tailwind CDN for the existing UI styling
- Ably JavaScript SDK for realtime messaging and presence
- Node.js and the Ably Node SDK for the local static server and auth endpoint
- Canvas 2D API for dial and target rendering

## Setup / Running Locally

Prerequisites: Node.js 24.10–24.x and npm.

1. Install the single server dependency:

   ```text
   npm install
   ```

2. Create a local environment file from the placeholder:

   ```text
   Copy-Item .env.example .env
   ```

   On macOS/Linux, use `cp .env.example .env` instead.

3. Edit `.env` and replace the placeholder with your own Ably API key. Keep this file local; it is ignored by Git.

   For the default local server, set `APP_ORIGIN=http://localhost:8000`. Localhost on the active server port is also accepted when `APP_ORIGIN` is omitted.

4. Start the local server:

   ```text
   npm start
   ```

5. Open `http://localhost:8000/` in a browser, enter a username, and create or join a room.

The server also supports a public configuration override when the client and auth endpoint are hosted separately. Define this object immediately before the inline application script in `index.html`:

   ```html
   <script>
     window.WAVELENGTH_CONFIG = {
       authUrl: "https://your-domain.example/api/ably-token"
     };
   </script>
   ```

Run `npm test` for the client/server regression checks, or `npm run check` for the server syntax check alone. The local server refuses to start when `ABLY_API_KEY` is missing; no real credential is included in this repository.

`npm run start` uses Node's optional `.env` loader. A local `.env` is loaded when present, while production platforms such as Render can provide the same variables directly without creating a file.

## Deploying as a Render Web Service

This repository is not deployed by default. To create a Render Free Web Service:

1. Create a new **Web Service** in Render and connect this repository.
2. Select the `main` branch and the **Node** runtime.
3. Set **Build Command** to `npm ci`.
4. Set **Start Command** to `npm run start`.
5. Add `ABLY_API_KEY` as a secret environment variable. Paste the real key only into Render's Environment page.
6. Add `APP_ORIGIN` with the exact public origin Render assigns, such as `https://your-service.onrender.com`. Do not include a trailing path, query string, or room code.
7. Leave `PORT` unset unless you have a specific reason to override Render's assigned port.
8. Deploy, then open the public service URL and verify a two-browser room join.

The server reads Render's `PORT`, binds on `0.0.0.0`, and falls back to port `8000` locally. Render terminates public HTTPS before forwarding requests to the Node service. Free services can cold-start after inactivity, so the first page or token request can take longer; the existing connecting/reconnecting states remain visible and Ably retries its authenticated connection.

Never commit `.env`. If the Render hostname changes or a custom domain becomes primary, update `APP_ORIGIN` to that exact HTTPS origin and redeploy.

### Tailwind production note

The current single-file client retains Tailwind's CDN runtime. Replacing it correctly would add a CSS compilation step, Tailwind development dependency/configuration, and a generated stylesheet solely to remove the console warning. That is disproportionate for this small no-build portfolio client, so no build system was added during this pass. The warning is non-functional, but a future production-hardening pass should compile and self-host the Tailwind CSS before treating the project as a higher-scale production service.

## Required Secure Ably Auth Endpoint

The included `server.mjs` is the smallest local implementation of this endpoint. It runs outside the browser and:

- reads `ABLY_API_KEY` from `.env` through Node's `--env-file` option;
- serves `index.html` and the other public files; and
- handles `GET /api/ably-token` without serving `.env` files as static content.

For a public deployment, the endpoint is a small server or serverless function that must:

1. Keep the Ably Root API key in server-side environment configuration only; never put it in this repository or return it to the browser.
2. Accept the `room` and `clientId` query parameters sent by the client.
3. Validate that the room matches `^[A-Z0-9]{1,20}$`, validate that the requested client ID matches `^wl-[a-f0-9]{32}$`, and allow only the matching local origin or the exact `APP_ORIGIN` configured for deployment.
4. Return an Ably TokenRequest generated with the server-side Ably SDK.
5. Bind the issued token to the requested `clientId` and scope its capability to the room channel `wavelength-lobby-${room}` with only the publish, subscribe, and presence operations needed by this game.
6. Return CORS headers only for the deployed game origin when the endpoint is on another origin, and avoid logging tokens or sensitive request data.

The client uses an Ably `authCallback` that requests a fresh TokenRequest with the same session-scoped `clientId` whenever Ably connects or refreshes authorization; it never uses `key` authentication. It rejects an auth response whose bound identity differs from its requested identity. This repository includes a local endpoint, but no public deployment is claimed by this portfolio copy. Ably recommends keeping the API key on a trusted server and issuing scoped, time-limited tokens to clients. [Ably token authentication documentation](https://ably.com/docs/auth/token)

## Known Limitations / Security

This is a portfolio-ready game and local auth server, not a cheat-proof production service. Because the current repository does not include an authoritative game backend:

- Host status, role assignment, countdown progression, target generation, clue state, score awards, and kick actions are coordinated by browser clients. Sender checks and bounded state validation reduce accidental misuse, but they cannot establish server-side authority.
- Chat identity is bound to the authenticated Ably client ID and displayed from presence, but moderation, server-enforced rate limits, durable history, and abuse reporting would require a trusted backend.
- Host failover is a deterministic client-side presence election. A malicious connected client could still publish forged game messages if the backend grants broad channel publish capability.
- Scores and round evaluation are computed in the browser and are therefore tamperable. A trusted server would be required for authoritative scoring, anti-cheat enforcement, replay protection, moderation, and durable game history.
- The active target is omitted from ordinary public state broadcasts, but the Psychic and any client that can tamper with its own runtime remain able to inspect or alter local state.
- The game state is not durably stored on a backend. Reload recovery is room- and tab-session-scoped; if every participant disconnects at once, there is no authoritative server snapshot to restore.
- Ably, Tailwind, and the browser runtime are loaded from external/CDN dependencies. A production deployment should pin versions, add an appropriate Content Security Policy, use HTTPS, and review dependency integrity.
- Render supplies HTTPS and the included server supports an exact deployment origin, but a larger public deployment should still add authenticated users, server-enforced abuse controls, and more comprehensive monitoring.

## AI-Assisted Development Disclosure

This project was developed substantially with Google Gemini assistance. I directed the product and game behavior, tested the game, evaluated results, and iterated on the implementation. This disclosure does not imply that I manually authored every line of code.
