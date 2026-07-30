# Tadi Tech 2.0

A modern Spotify companion for:

- finding the newest albums, EPs, and singles from every followed artist
- opening content in Spotify or playing it directly in the browser
- searching and viewing playlists you own or collaborate on
- sorting full playlist contents by track metadata
- persisting the visible order back to Spotify

## Spotify setup

The app uses Authorization Code with PKCE, so a separate authentication server
and a Spotify client secret are not required.

1. Copy `.env.example` to `.env.local`.
2. Add the Client ID from the v2 app in Spotify's developer dashboard.
3. Add this local Redirect URI to that app:
   `http://127.0.0.1:3000/api/auth/callback`
4. Run the app and open `http://127.0.0.1:3000` (Spotify does not allow
   `localhost` callback URLs).

For a deployed site, add its HTTPS origin followed by
`/api/auth/callback` as an additional Redirect URI.

## Browser playback

The persistent browser player uses Spotify's Web Playback SDK. It can start an
album, a full playlist, or an individual playlist track and includes
play/pause, previous, and next controls.

- Spotify Premium is required for browser playback.
- Existing users must reconnect once after playback is added so Spotify can
  grant the `streaming` and playback-control scopes.
- Access tokens remain in memory only and are refreshed through a private,
  same-origin endpoint; they are never stored in browser storage.
- Local or unavailable playlist tracks cannot be streamed through the Web API,
  but their normal Spotify link remains available when Spotify supplies one.

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Validation:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Spotify API notes

Spotify does not provide a tailored endpoint for new releases from followed
artists. Tadi Tech only starts a scan after an explicit click, advances through
the followed-artist list in small sequential batches, deduplicates releases,
and saves each completed batch in memory so a paused or interrupted scan can
continue without starting over. Pausing cancels the browser's active batch and
prevents the next batch from starting until the user continues; a Spotify
request that was already in flight may still finish. The progress indicator
shows checked artists and the overall percentage, including while paused.
For ordinary rate limits it honors Spotify's complete `Retry-After` window and
then resumes. Development Mode quota exhaustion is reported separately because
Spotify does not provide a retry time for it.

Audio Features (including BPM, key, energy, and danceability) are unavailable
to Spotify apps created after November 2024, so v2 uses supported metadata only.
