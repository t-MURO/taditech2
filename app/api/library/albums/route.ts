import {
  apiError,
  hasLibraryModifyScopes,
  hasLibraryReadScopes,
  spotifyFetch,
  spotifyJson,
  SpotifyError,
} from "@/lib/spotify";

export const dynamic = "force-dynamic";

type AlbumLibraryBody = {
  ids?: unknown;
};

const SPOTIFY_ID = /^[a-zA-Z0-9]{22}$/;
const MAX_LIBRARY_ITEMS = 40;

function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    (origin && new URL(origin).origin !== new URL(request.url).origin) ||
    (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site")
  );
}

async function albumIdsFrom(request: Request) {
  let body: AlbumLibraryBody;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    body = parsed as AlbumLibraryBody;
  } catch {
    throw new SpotifyError("A valid album selection is required.", 400);
  }

  if (!Array.isArray(body.ids)) {
    throw new SpotifyError("Choose at least one album.", 400);
  }
  const ids = Array.from(new Set(body.ids));
  if (
    ids.length === 0 ||
    ids.length > MAX_LIBRARY_ITEMS ||
    ids.some((id) => typeof id !== "string" || !SPOTIFY_ID.test(id))
  ) {
    throw new SpotifyError(
      `Choose between 1 and ${MAX_LIBRARY_ITEMS} valid albums.`,
      400,
    );
  }
  return ids as string[];
}

function albumUris(ids: string[]) {
  return ids.map((id) => `spotify:album:${id}`);
}

function spotifyLibraryPath(path: "/me/library" | "/me/library/contains", ids: string[]) {
  const query = new URLSearchParams({ uris: albumUris(ids).join(",") });
  return `${path}?${query.toString()}`;
}

async function ensureLibraryMutation(
  request: Request,
  method: "PUT" | "DELETE",
  ids: string[],
) {
  const response = await spotifyFetch(
    spotifyLibraryPath("/me/library", ids),
    { method, signal: request.signal },
  );
  if (!response.ok) {
    throw new SpotifyError(
      method === "PUT"
        ? "Spotify could not save this release to your library."
        : "Spotify could not remove this release from your library.",
      response.status,
      Number(response.headers.get("Retry-After") || 0) || undefined,
    );
  }
}

export async function POST(request: Request) {
  try {
    if (rejectCrossOrigin(request)) {
      return Response.json(
        { error: "Cross-origin library requests are not allowed." },
        { status: 403 },
      );
    }
    if (!(await hasLibraryReadScopes())) {
      throw new SpotifyError(
        "Reconnect Spotify to show saved releases.",
        403,
        undefined,
        "reauthorize",
      );
    }

    const ids = await albumIdsFrom(request);
    const contains = await spotifyJson<boolean[]>(
      spotifyLibraryPath("/me/library/contains", ids),
      { signal: request.signal },
    );
    const saved = Object.fromEntries(
      ids.map((id, index) => [id, contains[index] === true]),
    );
    return Response.json({ saved });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    if (rejectCrossOrigin(request)) {
      return Response.json(
        { error: "Cross-origin library requests are not allowed." },
        { status: 403 },
      );
    }
    if (!(await hasLibraryModifyScopes())) {
      throw new SpotifyError(
        "Reconnect Spotify to save releases to your library.",
        403,
        undefined,
        "reauthorize",
      );
    }

    const ids = await albumIdsFrom(request);
    await ensureLibraryMutation(request, "PUT", ids);
    return Response.json({ saved: true, ids });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (rejectCrossOrigin(request)) {
      return Response.json(
        { error: "Cross-origin library requests are not allowed." },
        { status: 403 },
      );
    }
    if (!(await hasLibraryModifyScopes())) {
      throw new SpotifyError(
        "Reconnect Spotify to update your saved releases.",
        403,
        undefined,
        "reauthorize",
      );
    }

    const ids = await albumIdsFrom(request);
    await ensureLibraryMutation(request, "DELETE", ids);
    return Response.json({ saved: false, ids });
  } catch (error) {
    return apiError(error);
  }
}
