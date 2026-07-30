# Tadi Tech v2

A modern Spotify companion for:

- finding the newest albums, EPs, and singles from every followed artist
- viewing playlists you own or collaborate on
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

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Validation:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Spotify API notes

Spotify does not provide a tailored endpoint for new releases from followed
artists. Tadi Tech paginates the followed-artist list, makes one combined
album/single lookup per artist with bounded concurrency, deduplicates releases,
respects rate limits, and keeps the result in memory for 15 minutes.

Audio Features (including BPM, key, energy, and danceability) are unavailable
to Spotify apps created after November 2024, so v2 uses supported metadata only.
