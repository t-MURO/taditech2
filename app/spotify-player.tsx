"use client";
/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */

import {
  ExternalLink,
  LoaderCircle,
  MonitorSpeaker,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampPlaybackPosition,
  clampPlaybackVolume,
  displayedPlaybackPosition,
  formatPlaybackTime,
  isSeekKey,
  playbackElapsed,
  playbackProgressPercent,
} from "@/lib/playback";
import { preferredSpotifyImage } from "@/lib/spotify-data";
import { spotifyAppHref } from "@/lib/spotify-links";

type SpotifyArtist = { name: string; uri: string };
type SpotifyImage = { url: string; height?: number; width?: number };
type SpotifyTrack = {
  id: string;
  uri: string;
  type?: string;
  name: string;
  duration_ms: number;
  artists?: SpotifyArtist[] | null;
  album?: {
    name: string;
    uri: string;
    images?: SpotifyImage[] | null;
  } | null;
};
type SpotifyState = {
  paused: boolean;
  position: number;
  duration: number;
  disallows?: {
    seeking?: boolean;
    skipping_next?: boolean;
    skipping_prev?: boolean;
  };
  track_window: { current_track: SpotifyTrack };
};
type SpotifyPlayer = {
  addListener(event: string, callback: (payload: never) => void): boolean;
  activateElement(): Promise<void>;
  connect(): Promise<boolean>;
  disconnect(): void;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
};
type SpotifyNamespace = {
  Player: new (options: {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume?: number;
    enableMediaSession?: boolean;
  }) => SpotifyPlayer;
};

declare global {
  interface Window {
    Spotify?: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

type PlayTarget = {
  contextUri?: string;
  offsetPosition?: number;
  offsetUri?: string;
  uris?: string[];
};
type PlaybackControl = "next" | "pause" | "play" | "previous";
type PlaybackContextValue = {
  authorized: boolean;
  currentTrackUri: string;
  deviceReady: boolean;
  isPlaying: boolean;
  pendingKey: string;
  play: (target: PlayTarget, key: string) => Promise<void>;
  queue: (uri: string, key: string) => Promise<boolean>;
};

const PlaybackContext = createContext<PlaybackContextValue | null>(null);
let sdkPromise: Promise<SpotifyNamespace> | null = null;
let tokenPromise: Promise<string> | null = null;
const DEFAULT_PLAYER_VOLUME = 0.72;
const PLAYER_VOLUME_STORAGE_KEY = "taditech-player-volume-v1";

class PlaybackClientError extends Error {
  code?: string;
  reconnect: boolean;

  constructor(message: string, reconnect = false, code?: string) {
    super(message);
    this.name = "PlaybackClientError";
    this.reconnect = reconnect;
    this.code = code;
  }
}

export function usePlayback() {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error("usePlayback must be used inside PlaybackProvider.");
  return value;
}

export function PlaybackProvider({
  authorized,
  children,
}: {
  authorized: boolean;
  children: ReactNode;
}) {
  const playerRef = useRef<SpotifyPlayer | null>(null);
  const [playerEnabled, setPlayerEnabled] = useState(authorized);
  const [volume, setVolume] = useState(DEFAULT_PLAYER_VOLUME);
  const volumeRef = useRef(DEFAULT_PLAYER_VOLUME);
  const lastAudibleVolumeRef = useRef(DEFAULT_PLAYER_VOLUME);
  const [deviceId, setDeviceId] = useState("");
  const deviceIdRef = useRef("");
  const [connecting, setConnecting] = useState(false);
  const [reconnectRequired, setReconnectRequired] = useState(!authorized);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<SpotifyState | null>(null);
  const stateRef = useRef<SpotifyState | null>(null);
  const [observedAt, setObservedAt] = useState(0);
  const [clock, setClock] = useState(0);
  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const pendingCommandRef = useRef("");
  const commandAcceptedRef = useRef(false);
  const commandAbortRef = useRef<AbortController | null>(null);
  const pendingTimeoutRef = useRef<number | null>(null);
  const transientTokenFailureRef = useRef(false);
  const seekDraftRef = useRef<number | null>(null);
  const seekTrackUriRef = useRef("");
  const currentTrackUriRef = useRef("");
  const seekPointerActiveRef = useRef(false);
  const seekKeyboardActiveRef = useRef(false);
  const seekCommitTimeoutRef = useRef<number | null>(null);
  const committedSeekRef = useRef<{
    trackUri: string;
    target: number;
    committedAt: number;
    expiresAt: number;
  } | null>(null);

  const setActiveDeviceId = useCallback((nextDeviceId: string) => {
    deviceIdRef.current = nextDeviceId;
    setDeviceId(nextDeviceId);
  }, []);

  const clearPending = useCallback(() => {
    commandAbortRef.current?.abort();
    commandAbortRef.current = null;
    if (pendingTimeoutRef.current !== null) {
      window.clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    pendingCommandRef.current = "";
    commandAcceptedRef.current = false;
    setPendingKey("");
  }, []);

  const clearSeekDraft = useCallback(() => {
    if (seekCommitTimeoutRef.current !== null) {
      window.clearTimeout(seekCommitTimeoutRef.current);
      seekCommitTimeoutRef.current = null;
    }
    seekPointerActiveRef.current = false;
    seekKeyboardActiveRef.current = false;
    seekDraftRef.current = null;
    seekTrackUriRef.current = "";
    setSeekDraft(null);
  }, []);

  const resetSeekState = useCallback(() => {
    stateRef.current = null;
    currentTrackUriRef.current = "";
    committedSeekRef.current = null;
    clearSeekDraft();
  }, [clearSeekDraft]);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
      if (storedValue === null) return;
      const storedVolume = Number(storedValue);
      if (!Number.isFinite(storedVolume)) return;
      const nextVolume = clampPlaybackVolume(storedVolume);
      volumeRef.current = nextVolume;
      if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume;
      setVolume(nextVolume);
    } catch {
      // A blocked or malformed preference should not prevent playback.
    }
  }, []);

  const updateVolume = useCallback((nextValue: number) => {
    const nextVolume = clampPlaybackVolume(nextValue);
    volumeRef.current = nextVolume;
    if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume;
    setVolume(nextVolume);
    try {
      window.localStorage.setItem(
        PLAYER_VOLUME_STORAGE_KEY,
        String(nextVolume),
      );
    } catch {
      // Volume still works for this session when storage is unavailable.
    }
    const player = playerRef.current;
    if (player) {
      void player.setVolume(nextVolume).catch((volumeError) => {
        setError(messageFrom(volumeError));
      });
    }
  }, []);

  const toggleMute = useCallback(() => {
    updateVolume(
      volume > 0
        ? 0
        : clampPlaybackVolume(lastAudibleVolumeRef.current),
    );
  }, [updateVolume, volume]);

  useEffect(() => {
    if (!authorized) {
      setConnecting(false);
      setReconnectRequired(true);
      setActiveDeviceId("");
      setState(null);
      setRetryAvailable(false);
      clearPending();
      resetSeekState();
      return;
    }
    if (!playerEnabled) {
      setConnecting(false);
      setReconnectRequired(false);
      setRetryAvailable(false);
      setActiveDeviceId("");
      setState(null);
      clearPending();
      resetSeekState();
      setError("");
      return;
    }

    let cancelled = false;
    let localPlayer: SpotifyPlayer | null = null;
    setConnecting(true);
    setReconnectRequired(false);
    setRetryAvailable(false);
    transientTokenFailureRef.current = false;
    resetSeekState();
    setError("");

    const setupPlayer = async () => {
      try {
        const Spotify = await loadSpotifySdk();
        if (cancelled) return;
        localPlayer = new Spotify.Player({
          name: "Tadi Tech Browser Player",
          volume: volumeRef.current,
          enableMediaSession: false,
          getOAuthToken: (callback) => {
            void fetchPlaybackToken()
              .then((token) => {
                if (cancelled) return;
                transientTokenFailureRef.current = false;
                callback(token);
              })
              .catch((tokenError) => {
                if (cancelled) return;
                const reconnect =
                  tokenError instanceof PlaybackClientError && tokenError.reconnect;
                transientTokenFailureRef.current = !reconnect;
                callback("");
                setActiveDeviceId("");
                setState(null);
                setConnecting(false);
                setReconnectRequired(reconnect);
                setRetryAvailable(!reconnect);
                clearPending();
                resetSeekState();
                setError(messageFrom(tokenError));
              });
          },
        });
        playerRef.current = localPlayer;

        localPlayer.addListener("ready", ((payload: { device_id: string }) => {
          if (cancelled) return;
          setActiveDeviceId(payload.device_id);
          setConnecting(false);
          setReconnectRequired(false);
          setRetryAvailable(false);
          transientTokenFailureRef.current = false;
          setError("");
        }) as (payload: never) => void);
        localPlayer.addListener("not_ready", ((payload: { device_id: string }) => {
          if (cancelled || deviceIdRef.current !== payload.device_id) return;
          setActiveDeviceId("");
          setState(null);
          setObservedAt(0);
          setClock(0);
          setConnecting(true);
          setRetryAvailable(true);
          clearPending();
          resetSeekState();
          setError("The browser player went offline. Waiting for Spotify to reconnect.");
        }) as (payload: never) => void);
        localPlayer.addListener("player_state_changed", ((nextState: SpotifyState | null) => {
          if (cancelled) return;
          if (!nextState) {
            setState(null);
            setObservedAt(0);
            setClock(0);
            clearPending();
            resetSeekState();
            return;
          }
          const now = Date.now();
          const nextTrackUri = nextState.track_window.current_track.uri;
          if (nextTrackUri !== currentTrackUriRef.current) {
            currentTrackUriRef.current = nextTrackUri;
            committedSeekRef.current = null;
            clearSeekDraft();
          }
          const committedSeek = committedSeekRef.current;
          const expectedCommittedPosition = committedSeek
            ? clampPlaybackPosition(
                committedSeek.target +
                  (nextState.paused ? 0 : now - committedSeek.committedAt),
                nextState.duration,
              )
            : nextState.position;
          const keepCommittedPosition =
            committedSeek !== null &&
            committedSeek.trackUri === nextTrackUri &&
            committedSeek.expiresAt > now &&
            Math.abs(nextState.position - expectedCommittedPosition) > 3_000;
          if (committedSeek && !keepCommittedPosition) {
            committedSeekRef.current = null;
          }
          const observedState = keepCommittedPosition
            ? { ...nextState, position: expectedCommittedPosition }
            : nextState;
          stateRef.current = observedState;
          setState(observedState);
          setObservedAt(now);
          setClock(now);
          if (commandAcceptedRef.current) clearPending();
        }) as (payload: never) => void);
        localPlayer.addListener("initialization_error", ((payload: { message: string }) => {
          if (cancelled) return;
          setActiveDeviceId("");
          setState(null);
          setConnecting(false);
          setRetryAvailable(true);
          clearPending();
          resetSeekState();
          setError(
            payload.message ||
              "This browser could not initialize Spotify’s protected audio player.",
          );
        }) as (payload: never) => void);
        localPlayer.addListener("authentication_error", (() => {
          if (cancelled) return;
          const transientFailure = transientTokenFailureRef.current;
          setActiveDeviceId("");
          setState(null);
          setConnecting(false);
          setReconnectRequired(!transientFailure);
          setRetryAvailable(transientFailure);
          clearPending();
          resetSeekState();
          setError(
            transientFailure
              ? "Spotify playback authorization is temporarily unavailable. Try the player again."
              : "Reconnect Spotify to grant browser playback permission.",
          );
        }) as (payload: never) => void);
        localPlayer.addListener("account_error", (() => {
          if (cancelled) return;
          setActiveDeviceId("");
          setState(null);
          setConnecting(false);
          setRetryAvailable(true);
          clearPending();
          resetSeekState();
          setError("Browser playback requires an active Spotify Premium account.");
        }) as (payload: never) => void);
        localPlayer.addListener("playback_error", ((payload: { message: string }) => {
          if (cancelled) return;
          clearPending();
          setError(payload.message || "Spotify could not play this item.");
        }) as (payload: never) => void);
        localPlayer.addListener("autoplay_failed", (() => {
          if (cancelled) return;
          clearPending();
          setError("Your browser blocked autoplay. Tap play once more to start listening.");
        }) as (payload: never) => void);

        const connected = await localPlayer.connect();
        if (!connected && !cancelled) {
          setActiveDeviceId("");
          setConnecting(false);
          setRetryAvailable(true);
          resetSeekState();
          setError("Spotify could not connect the browser player.");
        }
      } catch (setupError) {
        if (cancelled) return;
        setActiveDeviceId("");
        setConnecting(false);
        setRetryAvailable(true);
        resetSeekState();
        setError(messageFrom(setupError));
      }
    };
    const startPlayer = () => {
      void setupPlayer();
    };
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    };
    const idleHandle = idleWindow.requestIdleCallback?.(startPlayer, {
      timeout: 1_500,
    });
    const startupTimer =
      idleHandle === undefined
        ? window.setTimeout(startPlayer, 250)
        : null;

    return () => {
      cancelled = true;
      if (idleHandle !== undefined) {
        idleWindow.cancelIdleCallback?.(idleHandle);
      }
      if (startupTimer !== null) window.clearTimeout(startupTimer);
      clearPending();
      resetSeekState();
      localPlayer?.disconnect();
      if (playerRef.current === localPlayer) playerRef.current = null;
    };
  }, [
    authorized,
    clearPending,
    clearSeekDraft,
    playerEnabled,
    resetSeekState,
    retryNonce,
    setActiveDeviceId,
  ]);

  useEffect(() => {
    if (!state || state.paused) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const play = useCallback(
    async (target: PlayTarget, key: string) => {
      const player = playerRef.current;
      if (!authorized || reconnectRequired) {
        setReconnectRequired(true);
        setError("Reconnect Spotify to enable browser playback.");
        return;
      }
      if (!player || !deviceId) {
        setError("The browser player is still connecting. Try again in a moment.");
        return;
      }
      if (pendingCommandRef.current || seekDraftRef.current !== null) return;

      const commandController = new AbortController();
      commandAbortRef.current = commandController;
      const commandTimeout = window.setTimeout(
        () => commandController.abort(),
        15_000,
      );
      pendingCommandRef.current = key;
      commandAcceptedRef.current = false;
      setPendingKey(key);
      setError("");
      try {
        await abortable(player.activateElement(), commandController.signal);
        const response = await fetch("/api/playback/play", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, ...target }),
          signal: commandController.signal,
        });
        if (!response.ok) {
          throw await errorFromResponse(
            response,
            "Spotify could not start playback.",
          );
        }
        commandAcceptedRef.current = true;
        if (pendingCommandRef.current === key) {
          pendingTimeoutRef.current = window.setTimeout(() => {
            if (pendingCommandRef.current === key) clearPending();
          }, 4_000);
        }
      } catch (playError) {
        clearPending();
        if (
          playError instanceof PlaybackClientError &&
          playError.code === "playback_device_unavailable"
        ) {
          setActiveDeviceId("");
          setState(null);
          setConnecting(true);
          setRetryAvailable(false);
          resetSeekState();
          setRetryNonce((current) => current + 1);
        }
        if (playError instanceof PlaybackClientError && playError.reconnect) {
          setActiveDeviceId("");
          setState(null);
          setConnecting(false);
          setReconnectRequired(true);
          setRetryAvailable(false);
          resetSeekState();
        }
        setError(
          isAbortError(playError)
            ? "Spotify took too long to respond. Try playing the item again."
            : messageFrom(playError),
        );
      } finally {
        window.clearTimeout(commandTimeout);
        if (commandAbortRef.current === commandController) {
          commandAbortRef.current = null;
        }
      }
    },
    [
      authorized,
      clearPending,
      deviceId,
      reconnectRequired,
      resetSeekState,
      setActiveDeviceId,
    ],
  );

  const queue = useCallback(
    async (uri: string, key: string) => {
      if (!authorized || reconnectRequired) {
        setReconnectRequired(true);
        setError("Reconnect Spotify to add tracks to your queue.");
        return false;
      }
      if (pendingCommandRef.current || seekDraftRef.current !== null) {
        return false;
      }

      const commandController = new AbortController();
      commandAbortRef.current = commandController;
      const commandTimeout = window.setTimeout(
        () => commandController.abort(),
        15_000,
      );
      pendingCommandRef.current = key;
      commandAcceptedRef.current = false;
      setPendingKey(key);
      setError("");
      try {
        const response = await fetch("/api/playback/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uri,
            ...(deviceId && stateRef.current ? { deviceId } : {}),
          }),
          signal: commandController.signal,
        });
        if (!response.ok) {
          throw await errorFromResponse(
            response,
            "Spotify could not add this track to the queue.",
          );
        }
        return true;
      } catch (queueError) {
        if (queueError instanceof PlaybackClientError && queueError.reconnect) {
          setActiveDeviceId("");
          setState(null);
          setConnecting(false);
          setReconnectRequired(true);
          setRetryAvailable(false);
          resetSeekState();
        }
        setError(
          isAbortError(queueError)
            ? "Spotify took too long to update the queue. Try again."
            : messageFrom(queueError),
        );
        return false;
      } finally {
        window.clearTimeout(commandTimeout);
        if (pendingCommandRef.current === key) clearPending();
        if (commandAbortRef.current === commandController) {
          commandAbortRef.current = null;
        }
      }
    },
    [
      authorized,
      clearPending,
      deviceId,
      reconnectRequired,
      resetSeekState,
      setActiveDeviceId,
    ],
  );

  const deviceReady =
    authorized &&
    playerEnabled &&
    !reconnectRequired &&
    !connecting &&
    Boolean(deviceId);
  const currentTrack = state?.track_window.current_track;
  const currentTrackUri = currentTrack?.uri ?? "";
  const isPlaying = Boolean(currentTrack && state && !state.paused);
  const value = useMemo<PlaybackContextValue>(
    () => ({
      authorized: authorized && !reconnectRequired,
      currentTrackUri,
      deviceReady,
      isPlaying,
      pendingKey:
        pendingKey || (seekDraft !== null ? "control:seek-draft" : ""),
      play,
      queue,
    }),
    [
      authorized,
      currentTrackUri,
      deviceReady,
      isPlaying,
      pendingKey,
      play,
      queue,
      reconnectRequired,
      seekDraft,
    ],
  );

  const currentTrackUrl = currentTrack
    ? spotifyAppHref({ uri: currentTrack.uri }) ?? ""
    : "";
  const currentTrackImage = preferredSpotifyImage(currentTrack?.album?.images);
  const currentTrackArtists =
    currentTrack?.artists?.map((artist) => artist.name).join(", ") ||
    "Unknown artist";
  const elapsed = state
    ? playbackElapsed(
        state.position,
        state.duration,
        state.paused,
        observedAt,
        clock,
      )
    : 0;

  const runSeek = async (position: number, trackUri: string) => {
    const player = playerRef.current;
    const currentState = stateRef.current;
    if (
      !player ||
      !deviceReady ||
      !currentState ||
      !Number.isFinite(currentState.duration) ||
      currentState.duration <= 0 ||
      currentState.disallows?.seeking ||
      pendingCommandRef.current ||
      currentState.track_window.current_track.uri !== trackUri
    ) {
      clearSeekDraft();
      return;
    }

    const target = clampPlaybackPosition(position, currentState.duration);
    const commandKey = "control:seek";
    const commandController = new AbortController();
    commandAbortRef.current = commandController;
    const commandTimeout = window.setTimeout(
      () => commandController.abort(),
      10_000,
    );
    pendingCommandRef.current = commandKey;
    commandAcceptedRef.current = false;
    setPendingKey(commandKey);
    setError("");

    try {
      await abortable(player.activateElement(), commandController.signal);
      if (currentTrackUriRef.current !== trackUri) return;
      await abortable(player.seek(target), commandController.signal);
      if (currentTrackUriRef.current !== trackUri) return;

      const now = Date.now();
      committedSeekRef.current = {
        trackUri,
        target,
        committedAt: now,
        expiresAt: now + 5_000,
      };
      setState((current) => {
        const nextState =
          current?.track_window.current_track.uri === trackUri
            ? { ...current, position: target }
            : current;
        stateRef.current = nextState;
        return nextState;
      });
      setObservedAt(now);
      setClock(now);
    } catch (seekError) {
      setError(
        isAbortError(seekError)
          ? "Spotify took too long to seek. Try again."
          : messageFrom(seekError),
      );
    } finally {
      window.clearTimeout(commandTimeout);
      clearSeekDraft();
      if (pendingCommandRef.current === commandKey) {
        clearPending();
      }
      if (commandAbortRef.current === commandController) {
        commandAbortRef.current = null;
      }
    }
  };

  const commitSeekDraft = () => {
    if (seekCommitTimeoutRef.current !== null) {
      window.clearTimeout(seekCommitTimeoutRef.current);
      seekCommitTimeoutRef.current = null;
    }
    seekPointerActiveRef.current = false;
    seekKeyboardActiveRef.current = false;
    const draft = seekDraftRef.current;
    const trackUri = seekTrackUriRef.current;
    if (draft === null || !trackUri) {
      clearSeekDraft();
      return;
    }
    void runSeek(draft, trackUri);
  };

  const updateSeekDraft = (position: number) => {
    if (!state || !currentTrack) return;
    const nextPosition = clampPlaybackPosition(position, state.duration);
    seekDraftRef.current = nextPosition;
    seekTrackUriRef.current = currentTrack.uri;
    setSeekDraft(nextPosition);

    if (
      !seekPointerActiveRef.current &&
      !seekKeyboardActiveRef.current
    ) {
      if (seekCommitTimeoutRef.current !== null) {
        window.clearTimeout(seekCommitTimeoutRef.current);
      }
      seekCommitTimeoutRef.current = window.setTimeout(commitSeekDraft, 250);
    }
  };

  const playbackDuration =
    state && Number.isFinite(state.duration)
      ? Math.max(0, Math.round(state.duration))
      : 0;
  const displayedElapsed = state
    ? displayedPlaybackPosition(elapsed, seekDraft, playbackDuration)
    : 0;
  const seekProgress = state
    ? playbackProgressPercent(displayedElapsed, playbackDuration)
    : 0;
  const volumePercent = Math.round(volume * 100);
  const seekDisabled =
    !deviceReady ||
    !currentTrack ||
    !state ||
    playbackDuration <= 0 ||
    Boolean(state.disallows?.seeking) ||
    Boolean(pendingKey);

  const runControl = useCallback(async (control: PlaybackControl) => {
    if (
      !deviceReady ||
      !deviceId ||
      pendingCommandRef.current ||
      seekDraftRef.current !== null
    ) {
      return;
    }
    const commandKey = `control:${control}`;
    const pausedState =
      control === "pause"
        ? true
        : control === "play"
          ? false
          : undefined;
    const commandController = new AbortController();
    commandAbortRef.current = commandController;
    const commandTimeout = window.setTimeout(
      () => commandController.abort(),
      10_000,
    );
    pendingCommandRef.current = commandKey;
    commandAcceptedRef.current = false;
    setPendingKey(commandKey);
    setError("");
    try {
      const response = await fetch("/api/playback/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: control, deviceId }),
        signal: commandController.signal,
      });
      if (!response.ok) {
        throw await errorFromResponse(
          response,
          "Spotify could not apply this playback control.",
        );
      }
      if (pausedState !== undefined) {
        const now = Date.now();
        setState((current) => {
          if (!current) return current;
          const nextState = {
            ...current,
            paused: pausedState,
            position: playbackElapsed(
              current.position,
              current.duration,
              current.paused,
              observedAt,
              now,
            ),
          };
          stateRef.current = nextState;
          return nextState;
        });
        setObservedAt(now);
        setClock(now);
      }
    } catch (controlError) {
      if (
        controlError instanceof PlaybackClientError &&
        controlError.code === "playback_device_unavailable"
      ) {
        setActiveDeviceId("");
        setState(null);
        setConnecting(true);
        setRetryAvailable(false);
        resetSeekState();
        setRetryNonce((current) => current + 1);
      }
      if (
        controlError instanceof PlaybackClientError &&
        controlError.reconnect
      ) {
        setActiveDeviceId("");
        setState(null);
        setConnecting(false);
        setReconnectRequired(true);
        setRetryAvailable(false);
        resetSeekState();
      }
      setError(
        isAbortError(controlError)
          ? "Spotify took too long to respond. Try that control again."
          : messageFrom(controlError),
      );
    } finally {
      window.clearTimeout(commandTimeout);
      if (pendingCommandRef.current === commandKey) {
        clearPending();
      }
      if (commandAbortRef.current === commandController) {
        commandAbortRef.current = null;
      }
    }
  }, [
    clearPending,
    deviceId,
    deviceReady,
    observedAt,
    resetSeekState,
    setActiveDeviceId,
  ]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const mediaSession = navigator.mediaSession;
    const handlers: Array<[MediaSessionAction, () => void]> = [
      ["play", () => void runControl("play")],
      ["pause", () => void runControl("pause")],
      ["previoustrack", () => void runControl("previous")],
      ["nexttrack", () => void runControl("next")],
    ];
    for (const [action, handler] of handlers) {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Some browsers expose Media Session but not every action.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore unsupported actions during cleanup.
        }
      }
    };
  }, [runControl]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const mediaSession = navigator.mediaSession;
    mediaSession.playbackState = currentTrack
      ? state?.paused
        ? "paused"
        : "playing"
      : "none";
    if (!currentTrack) {
      mediaSession.metadata = null;
      return;
    }
    if (!("MediaMetadata" in window)) return;
    mediaSession.metadata = new MediaMetadata({
      title: currentTrack.name,
      artist: currentTrackArtists,
      album: currentTrack.album?.name ?? "",
      artwork: (currentTrack.album?.images ?? []).map((image) => ({
        src: image.url,
        ...(image.width && image.height
          ? { sizes: `${image.width}x${image.height}` }
          : {}),
      })),
    });
  }, [currentTrack, currentTrackArtists, state?.paused]);

  return (
    <PlaybackContext.Provider value={value}>
      {children}
      <aside className="browser-player" aria-label="Spotify browser player">
        <div className="player-track">
          {currentTrackImage ? (
            <img alt="" src={currentTrackImage} />
          ) : (
            <div className="player-art-placeholder"><MonitorSpeaker size={20} /></div>
          )}
          <div className="player-copy" aria-live="polite">
            <strong>
              {currentTrack?.name ||
                (reconnectRequired
                  ? "Enable browser playback"
                  : !playerEnabled
                    ? "Browser playback is off"
                  : connecting
                    ? "Preparing your browser player"
                    : deviceReady
                      ? "Browser player ready"
                      : "Browser player unavailable")}
            </strong>
            <span aria-live={error ? "assertive" : "polite"} role={error ? "alert" : "status"}>
              {currentTrack
                ? error ||
                  `${state?.paused ? "Paused" : "Playing"} · ${currentTrackArtists}`
                : error ||
                  (playerEnabled
                    ? "Choose Play on any release or playlist track."
                    : "Enable it when you want to play without slowing startup.")}
            </span>
          </div>
          {currentTrack && currentTrackUrl && (
            <a
              aria-label={`Open current ${spotifyItemKind(currentTrack.uri)} in the Spotify app`}
              className="player-mobile-open"
              href={currentTrackUrl}
              title="Open in Spotify app"
            >
              <ExternalLink size={17} />
            </a>
          )}
        </div>

        {reconnectRequired ? (
          <a className="player-enable" href="/api/auth/login?reauthorize=1">
            Reconnect Spotify
          </a>
        ) : !playerEnabled ? (
          <button
            className="player-enable"
            onClick={() => {
              setConnecting(true);
              setPlayerEnabled(true);
            }}
            type="button"
          >
            Enable player
          </button>
        ) : retryAvailable && !deviceReady ? (
          <button
            className="player-enable"
            onClick={() => setRetryNonce((current) => current + 1)}
            type="button"
          >
            Retry player
          </button>
        ) : (
          <div className="player-controls">
            <button
              aria-label="Previous track"
              disabled={
                !deviceReady ||
                !currentTrack ||
                Boolean(state?.disallows?.skipping_prev) ||
                Boolean(pendingKey) ||
                seekDraft !== null
              }
              onClick={() => void runControl("previous")}
              type="button"
            >
              <SkipBack size={16} fill="currentColor" />
            </button>
            <button
              aria-label={state?.paused ? "Play" : "Pause"}
              className={`player-toggle ${state?.paused ? "is-paused" : "is-playing"}`}
              disabled={
                !deviceReady ||
                !currentTrack ||
                Boolean(pendingKey) ||
                seekDraft !== null
              }
              onClick={() =>
                void runControl(state?.paused ? "play" : "pause")
              }
              title={state?.paused ? "Resume playback" : "Pause playback"}
              type="button"
            >
              {connecting
                ? <LoaderCircle className="spinner" size={18} />
                : state?.paused
                  ? <Play size={17} fill="currentColor" />
                  : <Pause size={17} fill="currentColor" />}
            </button>
            <button
              aria-label="Next track"
              disabled={
                !deviceReady ||
                !currentTrack ||
                Boolean(state?.disallows?.skipping_next) ||
                Boolean(pendingKey) ||
                seekDraft !== null
              }
              onClick={() => void runControl("next")}
              type="button"
            >
              <SkipForward size={16} fill="currentColor" />
            </button>
          </div>
        )}

        <div className={`player-status ${currentTrack && state ? "has-progress" : ""}`}>
          {currentTrack && state && (
            <div className="player-progress">
              <span aria-hidden="true">{formatPlaybackTime(displayedElapsed)}</span>
              <div className={`player-seek ${seekDisabled ? "disabled" : ""}`}>
                <div aria-hidden="true" className="player-seek-rail">
                  <i style={{ width: `${seekProgress}%` }} />
                </div>
                <input
                  aria-label="Seek playback position"
                  aria-valuetext={`${formatPlaybackTime(displayedElapsed)} of ${formatPlaybackTime(playbackDuration)}`}
                  disabled={seekDisabled}
                  max={playbackDuration}
                  min={0}
                  onBlur={() => {
                    if (seekDraftRef.current !== null) commitSeekDraft();
                  }}
                  onChange={(event) =>
                    updateSeekDraft(Number(event.currentTarget.value))
                  }
                  onKeyUp={(event) => {
                    if (isSeekKey(event.key)) {
                      seekKeyboardActiveRef.current = false;
                      commitSeekDraft();
                    }
                  }}
                  onPointerCancel={clearSeekDraft}
                  onKeyDown={(event) => {
                    if (!isSeekKey(event.key)) return;
                    seekKeyboardActiveRef.current = true;
                    if (seekCommitTimeoutRef.current !== null) {
                      window.clearTimeout(seekCommitTimeoutRef.current);
                      seekCommitTimeoutRef.current = null;
                    }
                  }}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    seekPointerActiveRef.current = true;
                    if (seekCommitTimeoutRef.current !== null) {
                      window.clearTimeout(seekCommitTimeoutRef.current);
                      seekCommitTimeoutRef.current = null;
                    }
                  }}
                  onPointerUp={commitSeekDraft}
                  step={1_000}
                  type="range"
                  value={displayedElapsed}
                />
              </div>
              <span aria-hidden="true">{formatPlaybackTime(playbackDuration)}</span>
            </div>
          )}
          <div className="player-volume">
            <button
              aria-label={volume > 0 ? "Mute browser player" : "Unmute browser player"}
              onClick={toggleMute}
              title={volume > 0 ? "Mute" : "Unmute"}
              type="button"
            >
              {volume > 0 ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <div className="player-volume-slider">
              <div aria-hidden="true" className="player-volume-rail">
                <i style={{ width: `${volumePercent}%` }} />
              </div>
              <input
                aria-label="Browser player volume"
                aria-valuetext={`${volumePercent}%`}
                max={100}
                min={0}
                onChange={(event) =>
                  updateVolume(Number(event.currentTarget.value) / 100)
                }
                step={1}
                type="range"
                value={volumePercent}
              />
            </div>
            <output aria-hidden="true">{volumePercent}%</output>
          </div>
          {currentTrack && currentTrackUrl ? (
            <a
              aria-label={`Open current ${spotifyItemKind(currentTrack.uri)} in the Spotify app`}
              href={currentTrackUrl}
              title="Open in Spotify app"
            >
              <ExternalLink size={14} />
            </a>
          ) : (
            <span
              className={`player-dot ${deviceReady ? "ready" : ""}`}
              title={deviceReady ? "Player ready" : "Player unavailable"}
            />
          )}
        </div>
      </aside>
    </PlaybackContext.Provider>
  );
}

function loadSpotifySdk() {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<SpotifyNamespace>((resolve, reject) => {
    const previousReady = window.onSpotifyWebPlaybackSDKReady;
    let script = document.getElementById("spotify-web-playback-sdk") as HTMLScriptElement | null;
    let settled = false;

    const restoreReadyHandler = () => {
      if (window.onSpotifyWebPlaybackSDKReady === handleReady) {
        window.onSpotifyWebPlaybackSDKReady = previousReady;
      }
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script?.removeEventListener("error", handleError);
      script?.remove();
      restoreReadyHandler();
      sdkPromise = null;
      reject(new Error(message));
    };
    const handleReady = () => {
      if (settled) return;
      try {
        previousReady?.();
      } catch {
        // Another SDK consumer should not prevent this player from connecting.
      }
      if (!window.Spotify) {
        fail("Spotify’s browser player did not initialize.");
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      script?.removeEventListener("error", handleError);
      restoreReadyHandler();
      resolve(window.Spotify);
    };
    const handleError = () => {
      fail("Spotify’s browser player could not be loaded.");
    };
    const timeout = window.setTimeout(
      () => fail("Spotify’s browser player took too long to load."),
      15_000,
    );

    window.onSpotifyWebPlaybackSDKReady = handleReady;
    let appendScript = false;
    if (!script) {
      script = document.createElement("script");
      script.id = "spotify-web-playback-sdk";
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      appendScript = true;
    }
    script.addEventListener("error", handleError, { once: true });
    if (appendScript) document.head.appendChild(script);
  });
  return sdkPromise;
}

async function fetchPlaybackToken() {
  if (tokenPromise) return tokenPromise;
  tokenPromise = requestPlaybackToken().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

async function requestPlaybackToken() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch("/api/playback/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new PlaybackClientError(
        "Spotify playback authorization took too long. Try the player again.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  let body: { accessToken?: string; error?: string; reconnect?: boolean } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Use the stable fallback below for proxy or platform errors.
  }
  if (!response.ok || !body.accessToken) {
    throw new PlaybackClientError(
      body.error || "Spotify playback authorization failed.",
      Boolean(body.reconnect) || response.status === 401,
    );
  }
  return body.accessToken;
}

async function errorFromResponse(response: Response, fallback: string) {
  let body: { code?: string; error?: string; reconnect?: boolean } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Use the caller's fallback for non-JSON responses.
  }
  return new PlaybackClientError(
    body.error || fallback,
    Boolean(body.reconnect) || response.status === 401,
    body.code,
  );
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Playback command timed out.", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(new DOMException("Playback command timed out.", "AbortError"));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function spotifyItemKind(uri: string) {
  const [, kind] = uri.split(":");
  return kind === "episode" ? "episode" : "track";
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Spotify playback is unavailable.";
}
