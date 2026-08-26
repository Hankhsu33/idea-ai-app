import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { bytesToBase64 } from './base64';
import { TOTAL_EXPECTED_BYTES } from './manifest';
import { DownloadCancelled, modelManager } from './modelManager';
import { RESOLUTIONS } from './types';
import type {
  Backend,
  DownloadProgressSnapshot,
  EngineError,
  EngineState,
  FromPageMessage,
  ModelStatus,
  ProgressPayload,
  Resolution,
  ResultPayload,
  ToPageMessage,
} from './types';

/* ------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------ */

/**
 * Bytes per RN -> page transfer chunk. 1 MB becomes ~1.37 MB of base64.
 *
 * Bigger chunks mean fewer injectJavaScript round trips, which is where the per-chunk
 * cost actually lives. Raised from 512 KB after measuring on device; going much beyond
 * this risks the payload limits of the native evaluateJavascript path.
 */
const CHUNK_SIZE = 1024 * 1024;

/** Hard ceiling on a single background removal before the engine is restarted. */
const PROCESS_TIMEOUT_MS = 30_000;

/** How long the page may go completely silent during start-up before we give up. */
const WARM_SILENCE_TIMEOUT_MS = 60_000;

/** How long to wait for a pong before assuming the WebView is wedged. */
const PING_TIMEOUT_MS = 3_000;

/** A page that dies this many times in a row is not going to recover by itself. */
const MAX_CONSECUTIVE_RELOADS = 3;

/** Synthetic https origin: never resolved, but it makes the page a secure context. */
const PAGE_ORIGIN = 'https://bgone.local/';

const LAST_RUN_KEY = 'bgone.lastRun.v1';

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

export interface ProcessResult extends ResultPayload {
  pngBase64: string;
}

export interface EngineContextValue {
  state: EngineState;
  error: EngineError | null;
  /** Live stage from the page (transfer/compile/infer/…). */
  progress: ProgressPayload | null;
  /** Live download progress, only while state is `downloading`. */
  download: DownloadProgressSnapshot | null;
  modelStatus: ModelStatus | null;
  backend: Backend | null;
  lastInferenceMs: number | null;
  /** Transient one-line message for the UI to surface and forget. */
  notice: string | null;
  /** Square edge the model runs at. Cost is roughly quadratic in this. */
  resolution: Resolution;

  process(imageBase64: string, mimeType: string): Promise<ProcessResult>;
  setResolution(size: Resolution): void;
  startDownload(): void;
  cancelDownload(): void;
  deleteModel(): Promise<void>;
  restartEngine(reason?: string): void;
  retry(): void;
  refreshModelStatus(): Promise<void>;
  dismissNotice(): void;
}

const EngineContext = createContext<EngineContextValue | null>(null);

export function useEngine(): EngineContextValue {
  const value = useContext(EngineContext);
  if (!value) throw new Error('useEngine must be used inside <EngineProvider>');
  return value;
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

interface Job {
  id: string;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** Re-armed whenever the page shows a sign of life for this job. */
  onTimeout: () => void;
  chunks: (string | undefined)[];
  resolve(result: ProcessResult): void;
  reject(error: Error): void;
}

/** A string that can be dropped into an injected JS source without escaping. */
function isSafeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function friendlyDownloadError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/network|internet|offline|timed out|Unable to resolve host|ENOTFOUND|connection/i.test(message)) {
    return 'The first download needs an internet connection.';
  }
  return 'The model download did not finish.';
}

export function EngineProvider({ children }: { children: React.ReactNode }) {
  /* --- render state ------------------------------------------------ */
  const [state, setStateRaw] = useState<EngineState>('cold');
  const [error, setError] = useState<EngineError | null>(null);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [download, setDownload] = useState<DownloadProgressSnapshot | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [backend, setBackend] = useState<Backend | null>(null);
  const [lastInferenceMs, setLastInferenceMs] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolution, setResolutionState] = useState<Resolution>(1024);
  const [html, setHtml] = useState<string | null>(null);
  const [webKey, setWebKey] = useState(0);
  /** Set once the engine has given up, so the dead page stops occupying memory. */
  const [webDisabled, setWebDisabled] = useState(false);
  /** Bumped by Retry to re-attempt reading the bundled engine page. */
  const [htmlAttempt, setHtmlAttempt] = useState(0);

  /* --- authoritative state ------------------------------------------
   * setState is asynchronous, so every guard reads the ref. Without this a
   * double tap can pass the `state === 'ready'` check twice before React
   * re-renders.
   * ----------------------------------------------------------------- */
  const stateRef = useRef<EngineState>('cold');
  const setState = useCallback((next: EngineState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const webRef = useRef<WebView>(null);
  /** Bumped on every WebView remount; stale async work compares against it and bails. */
  const generationRef = useRef(0);
  /** Mirrors `webKey`. Each mounted WebView closes over the key it was mounted with,
   *  so a message from a page that has since been replaced can be recognised. */
  const webKeyRef = useRef(0);
  const pageReadyRef = useRef(false);
  const jobRef = useRef<Job | null>(null);
  const busyRef = useRef(false);
  const jobSeq = useRef(0);
  const pingSeq = useRef(0);
  const pendingPingRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const warmWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadCountRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const healthCheckPendingRef = useRef(false);
  const unmountedRef = useRef(false);

  /**
   * Sticky once set: this device's WebView cannot do WebGPU, so never spend a start-up
   * finding that out again. Persisted, so later launches skip it too.
   */
  const forceWasmRef = useRef(false);

  /** Mirrors `resolution` for use inside callbacks that must not re-create. */
  const resolutionRef = useRef<Resolution>(1024);

  /** Mirrors what is in AsyncStorage so Settings can show numbers before the first run. */
  const lastRunRef = useRef<{ backend?: Backend; inferenceMs?: number; forceWasm?: boolean; resolution?: Resolution }>({});
  const persistLastRun = useCallback(
    (patch: { backend?: Backend; inferenceMs?: number; forceWasm?: boolean; resolution?: Resolution }) => {
      lastRunRef.current = { ...lastRunRef.current, ...patch };
      AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify(lastRunRef.current)).catch(() => {
        /* cosmetic only */
      });
    },
    []
  );

  const remountWebView = useCallback(() => {
    webKeyRef.current += 1;
    setWebKey(webKeyRef.current);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => {
      setNotice((current) => (current === message ? null : current));
    }, 4000);
  }, []);

  /* ------------------------------------------------------------------ *
   * Outbound
   * ------------------------------------------------------------------ */

  const post = useCallback((message: ToPageMessage) => {
    const view = webRef.current;
    if (!view) return;
    // JSON.stringify leaves U+2028/U+2029 raw; escaping them keeps the injected source
    // valid on engines that still treat them as line terminators inside string literals.
    const json = JSON.stringify(message)
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    view.injectJavaScript(`window.__BGONE_RECV(${JSON.stringify(json)});true;`);
  }, []);

  const postChunk = useCallback((requestId: string, offset: number, base64: string) => {
    const view = webRef.current;
    if (!view) return;
    // base64's alphabet is A-Za-z0-9+/= — no quote, backslash or newline can appear,
    // so the payload is safe inside a JS string literal without any escaping pass.
    view.injectJavaScript(`window.__BGONE_CHUNK("${requestId}",${offset},"${base64}");true;`);
  }, []);

  /* ------------------------------------------------------------------ *
   * Watchdogs
   * ------------------------------------------------------------------ */

  const clearWarmWatchdog = useCallback(() => {
    if (warmWatchdogRef.current) {
      clearTimeout(warmWatchdogRef.current);
      warmWatchdogRef.current = null;
    }
  }, []);

  const restartEngineRef = useRef<(reason: string, userFacing?: string) => void>(() => {});

  const armWarmWatchdog = useCallback(() => {
    clearWarmWatchdog();
    warmWatchdogRef.current = setTimeout(() => {
      warmWatchdogRef.current = null;
      const current = stateRef.current;
      if (current === 'initializing' || current === 'warming') {
        restartEngineRef.current('warm-up went silent', 'Start-up stalled — the engine was restarted.');
      }
    }, WARM_SILENCE_TIMEOUT_MS);
  }, [clearWarmWatchdog]);

  /**
   * Asks the page to prove it is alive. A missing pong is the only thing that can
   * declare a page dead without it having thrown, so the reply drives recovery:
   * see the `pong` handler, which promotes `inference_failed` back to `ready`.
   */
  const sendPing = useCallback(() => {
    if (!pageReadyRef.current || pendingPingRef.current) return;

    const id = `p${++pingSeq.current}`;
    const timer = setTimeout(() => {
      pendingPingRef.current = null;
      restartEngineRef.current('no pong', 'Engine restarted.');
    }, PING_TIMEOUT_MS);

    pendingPingRef.current = { id, timer };
    post({ id, type: 'ping' });
  }, [post]);

  /* ------------------------------------------------------------------ *
   * Job settlement — one funnel so the timeout/result race has one winner
   * ------------------------------------------------------------------ */

  const settleJob = useCallback(
    (job: Job, outcome: { ok: true; value: ProcessResult } | { ok: false; error: Error }) => {
      if (job.settled) return;
      job.settled = true;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      if (jobRef.current === job) jobRef.current = null;
      busyRef.current = false;

      if (outcome.ok) {
        job.resolve(outcome.value);
      } else {
        job.reject(outcome.error);
      }
    },
    []
  );

  /* ------------------------------------------------------------------ *
   * Restart
   * ------------------------------------------------------------------ */

  const restartEngine = useCallback(
    (reason: string, userFacing?: string) => {
      console.warn(`[bgone] restarting engine: ${reason}`);

      generationRef.current += 1;
      pageReadyRef.current = false;
      clearWarmWatchdog();

      if (pendingPingRef.current) {
        clearTimeout(pendingPingRef.current.timer);
        pendingPingRef.current = null;
      }

      const job = jobRef.current;
      if (job) {
        settleJob(job, { ok: false, error: new Error(userFacing ?? 'The engine restarted.') });
      }
      busyRef.current = false;

      reloadCountRef.current += 1;
      if (reloadCountRef.current > MAX_CONSECUTIVE_RELOADS) {
        // Stop the loop *and* take the page down. Leaving a wedged WebView mounted
        // would keep a dead engine holding memory with nothing able to use it.
        setWebDisabled(true);
        setProgress(null);
        setBackend(null);
        setState('engine_failed');
        setError({
          message: 'The engine keeps failing to start on this device.',
          action: 'retry',
        });
        return;
      }

      if (userFacing) showNotice(userFacing);
      setProgress(null);
      setBackend(null);
      setWebDisabled(false);
      remountWebView();

      // A crash during the download must not steal the `downloading` state: the model
      // transfer owns the UI until it finishes, and there is nothing to warm yet.
      if (stateRef.current !== 'downloading') {
        setState('initializing');
        armWarmWatchdog();
      }
    },
    [armWarmWatchdog, clearWarmWatchdog, remountWebView, setState, settleJob, showNotice]
  );

  restartEngineRef.current = restartEngine;

  /* ------------------------------------------------------------------ *
   * File serving
   * ------------------------------------------------------------------ */

  /** file name -> token of the transfer that is allowed to be streaming it. */
  const activeServeRef = useRef(new Map<string, number>());
  const serveTokenRef = useRef(0);

  const serveOne = useCallback(
    async (requestId: string, name: string, token: number, url: string) => {
      const generation = generationRef.current;
      const superseded = () => activeServeRef.current.get(name) !== token;
      const fail = (message: string) => {
        if (generation !== generationRef.current) return;
        post({ id: requestId, type: 'fileError', payload: { requestId, message } });
      };

      if (!isSafeToken(requestId)) {
        console.warn('[bgone] ignoring a file request with a malformed id');
        return;
      }

      let handle: ReturnType<typeof modelManager.openForRead> | null = null;
      try {
        // Not on disk (deleted, or a wasm variant the pinned list did not predict):
        // pull it now if we can. This is the only path that can touch the network
        // after the initial download, and it never runs in the steady state.
        try {
          handle = modelManager.openForRead(name);
        } catch {
          await modelManager.ensureFile(name, url);
          if (generation !== generationRef.current) return;
          handle = modelManager.openForRead(name);
        }

        const { size } = handle;
        if (size <= 0) {
          // The page waits for bytes that would never arrive, so say so instead.
          fail(`${name} is empty on disk`);
          return;
        }
        post({ id: requestId, type: 'fileMeta', payload: { requestId, size } });

        let sent = 0;
        while (sent < size) {
          if (generation !== generationRef.current || unmountedRef.current) return;
          // The page asked for this file again, which means it gave up on this
          // transfer. Stop pushing bytes nobody is going to reassemble.
          if (superseded()) return;

          const bytes = handle.read(CHUNK_SIZE);
          if (!bytes.length) break;

          postChunk(requestId, sent, bytesToBase64(bytes));
          sent += bytes.length;

          // Yield so the UI thread and the message queue keep running between chunks.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        if (sent < size) fail(`${name} ended early`);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      } finally {
        handle?.close();
      }
    },
    [post, postChunk]
  );

  /**
   * Transfers run one at a time.
   *
   * Transformers.js asks for the weights and the WebAssembly runtime concurrently;
   * interleaving two multi-megabyte streams would double peak memory on both sides and
   * halve the useful throughput of each. Serialising costs nothing — the page cannot
   * start work until both have landed anyway.
   */
  const serveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const serveFile = useCallback(
    (requestId: string, name: string, url: string) => {
      // Claim the name before queueing, so a transfer already running for it sees that
      // it has been superseded on its very next chunk instead of running to the end.
      const token = ++serveTokenRef.current;
      activeServeRef.current.set(name, token);

      serveQueueRef.current = serveQueueRef.current
        .catch(() => undefined)
        .then(() => serveOne(requestId, name, token, url));
      return serveQueueRef.current;
    },
    [serveOne]
  );

  /* ------------------------------------------------------------------ *
   * Warm
   * ------------------------------------------------------------------ */

  const maybeWarm = useCallback(async () => {
    if (!pageReadyRef.current) return;
    if (stateRef.current === 'downloading') return;
    // A page that is already serving must not be knocked back to `initializing`.
    if (stateRef.current === 'ready' || stateRef.current === 'processing') return;
    // The reload ceiling has been hit. Only an explicit Retry or Restart engine may
    // start warming again — otherwise an automatic path would quietly re-enter the
    // loop the ceiling exists to stop.
    if (stateRef.current === 'engine_failed') return;

    const ready = await modelManager.isReady();
    if (!ready) return;
    if (!pageReadyRef.current) return;

    setState('initializing');
    armWarmWatchdog();
    post({
      id: 'warm',
      type: 'warm',
      payload: {
        forceWasm: forceWasmRef.current,
        size: resolutionRef.current,
        manifest: modelManager.sizeMap(),
      },
    });
  }, [armWarmWatchdog, post, setState]);

  /* ------------------------------------------------------------------ *
   * Inbound
   * ------------------------------------------------------------------ */

  const onMessage = useCallback(
    (mountKey: number, event: WebViewMessageEvent) => {
      // A message from a WebView that has already been replaced must not be allowed to
      // drive the state machine — a stale `warmed`, in particular, would mark a fresh
      // page as ready without it having loaded anything.
      if (mountKey !== webKeyRef.current) return;

      let message: FromPageMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as FromPageMessage;
      } catch {
        console.warn('[bgone] unparseable message from the engine page');
        return;
      }

      // Any sign of life resets the start-up watchdog.
      if (stateRef.current === 'initializing' || stateRef.current === 'warming') armWarmWatchdog();

      switch (message.type) {
        case 'ready': {
          pageReadyRef.current = true;
          console.log(
            `[bgone] page ready · webgpu=${message.payload.hasWebGPU} secure=${message.payload.secureContext} origin=${message.payload.origin}`
          );
          void maybeWarm();
          break;
        }

        case 'fileRequest': {
          void serveFile(message.payload.requestId, message.payload.name, message.payload.url);
          break;
        }

        case 'runtime': {
          console.log(
            `[bgone] transformers=${message.payload.transformers} ort=${message.payload.ort} wasm=${JSON.stringify(message.payload.wasmPaths)}`
          );
          break;
        }

        case 'progress': {
          setProgress(message.payload);
          if (message.payload.stage === 'infer' && stateRef.current === 'initializing') {
            setState('warming');
          }
          break;
        }

        case 'warmed': {
          console.log(
            `[bgone] warmed · backend=${message.payload.backend} · ${message.payload.ms} ms · ${resolutionRef.current}px`
          );
          clearWarmWatchdog();
          reloadCountRef.current = 0;
          setBackend(message.payload.backend);
          setProgress(null);
          setError(null);
          setState('ready');
          persistLastRun({ backend: message.payload.backend });
          if (healthCheckPendingRef.current) healthCheckPendingRef.current = false;
          break;
        }

        case 'needsWasmRestart': {
          console.warn(`[bgone] webgpu unusable, restarting on wasm: ${message.payload.reason}`);
          forceWasmRef.current = true;
          persistLastRun({ forceWasm: true });
          // A planned downgrade, not a fault: it must not consume the reload budget,
          // and the user has no reason to be told about it.
          reloadCountRef.current = 0;
          restartEngineRef.current('webgpu unusable, restarting on wasm');
          break;
        }

        case 'resultChunk': {
          const job = jobRef.current;
          if (!job || job.id !== message.id || job.settled) return;
          job.chunks[message.payload.index] = message.payload.data;

          // Delivery of a multi-megabyte PNG is progress, not silence. Without this a
          // result that lands near the deadline could be thrown away mid-transfer.
          if (job.timer) {
            clearTimeout(job.timer);
            job.timer = setTimeout(job.onTimeout, PROCESS_TIMEOUT_MS);
          }
          break;
        }

        case 'result': {
          const job = jobRef.current;
          if (!job || job.id !== message.id || job.settled) return;

          const { chunks } = message.payload;
          const parts: string[] = [];
          for (let i = 0; i < chunks; i++) {
            const part = job.chunks[i];
            if (part === undefined) {
              settleJob(job, { ok: false, error: new Error('The result came back incomplete.') });
              setProgress(null);
              setState('inference_failed');
              setError({ message: 'The cutout did not come back in one piece.', action: 'retry' });
              sendPing();
              return;
            }
            parts.push(part);
          }

          settleJob(job, { ok: true, value: { ...message.payload, pngBase64: parts.join('') } });
          setProgress(null);
          setBackend(message.payload.backend);
          setLastInferenceMs(message.payload.inferenceMs);
          setState('ready');
          persistLastRun({
            backend: message.payload.backend,
            inferenceMs: message.payload.inferenceMs,
          });
          break;
        }

        case 'pong': {
          const pending = pendingPingRef.current;
          if (pending && pending.id === message.id) {
            clearTimeout(pending.timer);
            pendingPingRef.current = null;

            // One image failing does not mean the engine did: the page catches
            // per-job errors and keeps its session. If it answers, take it back.
            if (stateRef.current === 'inference_failed' && !message.payload.busy) {
              setState('ready');
            }
          }
          break;
        }

        case 'unloaded': {
          break;
        }

        case 'error': {
          const { message: text, fatal } = message.payload;
          console.warn(`[bgone] engine error (fatal=${fatal}): ${text}`);

          const job = jobRef.current;
          if (job && job.id === message.id) {
            settleJob(job, { ok: false, error: new Error('That image could not be processed.') });
            setProgress(null);
            setState('inference_failed');
            setError({ message: 'That image could not be processed.', action: 'retry' });
            // Confirm the page survived it; the pong handler puts us back to `ready`
            // so the user can just try another image without restarting anything.
            sendPing();
            return;
          }

          if (fatal) {
            clearWarmWatchdog();
            // A fatal page error is not going to produce a result, so do not leave a
            // job (and busyRef) pending until its watchdog eventually notices.
            if (job) {
              settleJob(job, { ok: false, error: new Error('The engine stopped unexpectedly.') });
            }
            setProgress(null);
            setState('engine_failed');
            setError({ message: 'The engine could not start on this device.', action: 'retry' });
          }
          break;
        }

        case 'log': {
          console.log(`[bgone:page] ${message.payload.line}`);
          break;
        }
      }
    },
    [
      armWarmWatchdog,
      clearWarmWatchdog,
      maybeWarm,
      persistLastRun,
      sendPing,
      serveFile,
      setState,
      settleJob,
    ]
  );

  /* ------------------------------------------------------------------ *
   * Public actions
   * ------------------------------------------------------------------ */

  const refreshModelStatus = useCallback(async () => {
    const status = await modelManager.getStatus();
    if (!unmountedRef.current) setModelStatus(status);
  }, []);

  const runDownload = useCallback(async () => {
    setError(null);
    setState('downloading');
    setDownload({
      bytesDownloaded: 0,
      bytesTotal: TOTAL_EXPECTED_BYTES,
      currentFile: '',
      fileIndex: 0,
      fileCount: 0,
    });

    const unsubscribe = modelManager.subscribe((snapshot) => {
      if (!unmountedRef.current) setDownload(snapshot);
    });

    try {
      await modelManager.download();
      await refreshModelStatus();

      // `download()` also resolves when it was paused on the way to the background.
      // Staying in `downloading` is what lets the foreground handler pick it back up.
      if (!(await modelManager.isReady())) return;

      setDownload(null);
      setState('initializing');
      armWarmWatchdog();
      await maybeWarm();
    } catch (e) {
      setDownload(null);
      if (e instanceof DownloadCancelled) {
        setState('cold');
        await refreshModelStatus();
        return;
      }
      console.warn('[bgone] download failed', e);
      setState('download_failed');
      setError({ message: friendlyDownloadError(e), action: 'retry' });
      await refreshModelStatus();
    } finally {
      unsubscribe();
    }
  }, [armWarmWatchdog, maybeWarm, refreshModelStatus, setState]);

  const startDownload = useCallback(() => {
    if (stateRef.current === 'downloading') return;
    void runDownload();
  }, [runDownload]);

  const cancelDownload = useCallback(() => {
    modelManager.cancel();
  }, []);

  const deleteModel = useCallback(async () => {
    if (stateRef.current === 'processing') {
      showNotice('Finish the current cutout first.');
      return;
    }

    // Make the page let go of the weights before the files vanish underneath it.
    generationRef.current += 1;
    post({ id: 'unload', type: 'unload' });

    await modelManager.deleteAll();
    await refreshModelStatus();

    pageReadyRef.current = false;
    setBackend(null);
    setProgress(null);
    setError(null);
    setState('cold');
    remountWebView();
    showNotice('Model deleted.');
  }, [post, refreshModelStatus, remountWebView, setState, showNotice]);

  const process = useCallback(
    (imageBase64: string, mimeType: string): Promise<ProcessResult> => {
      // Synchronous guard: two taps in the same frame both reach here before any
      // re-render, so the ref is what actually keeps them apart.
      if (busyRef.current) {
        return Promise.reject(new Error('Already working on an image.'));
      }
      if (stateRef.current !== 'ready') {
        return Promise.reject(new Error(notReadyMessage(stateRef.current)));
      }

      busyRef.current = true;

      // A ping outstanding when a run starts is unanswerable: the page is about to be
      // busy for seconds, and its 3 s deadline would restart a perfectly healthy engine.
      if (pendingPingRef.current) {
        clearTimeout(pendingPingRef.current.timer);
        pendingPingRef.current = null;
      }

      setState('processing');
      setProgress({ stage: 'preprocess', ratio: null, detail: 'starting' });

      const id = `j${++jobSeq.current}`;

      return new Promise<ProcessResult>((resolve, reject) => {
        const job: Job = {
          id,
          settled: false,
          timer: null,
          onTimeout: () => {},
          chunks: [],
          resolve,
          reject,
        };
        jobRef.current = job;

        job.onTimeout = () => {
          if (job.settled) return;
          settleJob(job, {
            ok: false,
            error: new Error('That took too long — the engine was restarted. Try again.'),
          });
          setProgress(null);
          setState('inference_timeout');
          setError({
            message: 'That took too long — the engine was restarted, try again.',
            action: 'retry',
          });
          restartEngineRef.current('inference watchdog fired');
        };

        job.timer = setTimeout(job.onTimeout, PROCESS_TIMEOUT_MS);

        post({ id, type: 'process', payload: { imageBase64, mimeType } });
      });
    },
    [post, setState, settleJob]
  );

  const retry = useCallback(() => {
    setError(null);
    reloadCountRef.current = 0;
    setWebDisabled(false);
    if (!html) setHtmlAttempt((n) => n + 1);

    const current = stateRef.current;
    if (current === 'download_failed') {
      void runDownload();
      return;
    }
    restartEngineRef.current('user asked to retry');
  }, [html, runDownload]);

  /**
   * Changing resolution rebuilds only the processor, which is inline config — no
   * download, no transfer, no session reload. It applies to the next run.
   */
  const setResolution = useCallback(
    (size: Resolution) => {
      resolutionRef.current = size;
      setResolutionState(size);
      persistLastRun({ resolution: size });
      if (pageReadyRef.current) {
        post({ id: `res${size}`, type: 'setResolution', payload: { size } });
      }
    },
    [persistLastRun, post]
  );

  const restartEnginePublic = useCallback((reason?: string) => {
    reloadCountRef.current = 0;
    setError(null);
    setWebDisabled(false);
    restartEngineRef.current(reason ?? 'manual restart', 'Engine restarted.');
  }, []);

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Load the bundled page. Re-runs when Retry bumps the attempt counter, so a failure
  // to read the asset is recoverable — without it, Retry would remount a WebView that
  // has no HTML to show and nothing would happen.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const asset = Asset.fromModule(require('../../assets/webview/inference.html'));
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        const source = await new File(uri).text();
        if (!cancelled) setHtml(source);
      } catch (e) {
        console.warn('[bgone] could not read the engine page', e);
        if (!cancelled) {
          setState('engine_failed');
          setError({ message: 'The engine page could not be loaded.', action: 'retry' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [htmlAttempt, setState]);

  // Restore the last run's numbers, then decide whether to download.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            backend?: Backend;
            inferenceMs?: number;
            forceWasm?: boolean;
            resolution?: Resolution;
          };
          lastRunRef.current = parsed;
          if (parsed.inferenceMs) setLastInferenceMs(parsed.inferenceMs);
          // Known-bad WebGPU on this device: skip the doomed attempt from the start.
          if (parsed.forceWasm) forceWasmRef.current = true;
          if (parsed.resolution && RESOLUTIONS.includes(parsed.resolution)) {
            resolutionRef.current = parsed.resolution;
            setResolutionState(parsed.resolution);
          }
        }
      } catch {
        /* cosmetic only */
      }

      await refreshModelStatus();

      if (await modelManager.isReady()) {
        setState('initializing');
        armWarmWatchdog();
        await maybeWarm();
      } else {
        await runDownload();
      }
    })();
    // Deliberately runs once: this is the launch sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ *
   * Foreground / background
   * ------------------------------------------------------------------ */

  const healthCheck = useCallback(() => {
    if (stateRef.current !== 'ready') return;
    sendPing();
  }, [sendPing]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const previous = appStateRef.current;
      appStateRef.current = next;

      if (next === 'background' || next === 'inactive') {
        void modelManager.pauseForBackground();

        // Suspended time is not thinking time. Leaving the watchdog armed would turn
        // "user checked a notification" into a destroyed, otherwise healthy run.
        const job = jobRef.current;
        if (job && !job.settled && job.timer) {
          clearTimeout(job.timer);
          job.timer = null;
        }
        return;
      }

      if (next === 'active' && previous !== 'active') {
        // Re-arm the job watchdog with a full budget, having paused it on the way out.
        const job = jobRef.current;
        if (job && !job.settled && !job.timer) {
          job.timer = setTimeout(job.onTimeout, PROCESS_TIMEOUT_MS);
        }

        if (stateRef.current === 'downloading') {
          void runDownload();
          return;
        }
        if (stateRef.current === 'ready') {
          // Already idle: probe now. Waiting on a state *change* would never fire,
          // because coming back to a still-ready engine changes nothing.
          healthCheck();
          return;
        }
        // The page is single threaded: a ping sent mid-inference cannot be answered
        // until the run finishes, so defer until the engine reports `ready`.
        healthCheckPendingRef.current = true;
      }
    });
    return () => subscription.remove();
  }, [healthCheck, runDownload]);

  useEffect(() => {
    if (state === 'ready' && healthCheckPendingRef.current) {
      healthCheckPendingRef.current = false;
      healthCheck();
    }
  }, [state, healthCheck]);

  useEffect(
    () => () => {
      clearWarmWatchdog();
      if (pendingPingRef.current) clearTimeout(pendingPingRef.current.timer);
      if (jobRef.current?.timer) clearTimeout(jobRef.current.timer);
    },
    [clearWarmWatchdog]
  );

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */

  // A fresh object literal here would look like a new source on every render and
  // send the WebView into a reload loop.
  const source = useMemo(() => (html ? { html, baseUrl: PAGE_ORIGIN } : null), [html]);

  const value = useMemo<EngineContextValue>(
    () => ({
      state,
      error,
      progress,
      download,
      modelStatus,
      backend,
      lastInferenceMs,
      notice,
      resolution,
      process,
      setResolution,
      startDownload,
      cancelDownload,
      deleteModel,
      restartEngine: restartEnginePublic,
      retry,
      refreshModelStatus,
      dismissNotice: () => setNotice(null),
    }),
    [
      state,
      error,
      progress,
      download,
      modelStatus,
      backend,
      lastInferenceMs,
      notice,
      resolution,
      process,
      setResolution,
      startDownload,
      cancelDownload,
      deleteModel,
      restartEnginePublic,
      retry,
      refreshModelStatus,
    ]
  );

  return (
    <EngineContext.Provider value={value}>
      {children}
      {/* Offscreen but mounted and laid out: a display:none WebView is suspended on
          both platforms, which would stall the engine whenever a tab changed. */}
      <View style={styles.host} pointerEvents="none">
        {source && !webDisabled ? (
          <WebView
            key={webKey}
            ref={webRef}
            source={source}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            cacheEnabled={false}
            incognito={false}
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode="never"
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            mediaPlaybackRequiresUserAction
            androidLayerType="hardware"
            webviewDebuggingEnabled={__DEV__}
            onMessage={(event) => onMessage(webKey, event)}
            onShouldStartLoadWithRequest={(request) => {
              const { url } = request;
              const allowed =
                url.startsWith(PAGE_ORIGIN) ||
                url.startsWith('about:') ||
                url.startsWith('blob:') ||
                url.startsWith('data:');
              if (!allowed) console.warn(`[bgone] blocked navigation to ${url}`);
              return allowed;
            }}
            onError={(e) =>
              restartEngineRef.current(
                `webview error: ${e.nativeEvent.description}`,
                'Engine restarted.'
              )
            }
            onRenderProcessGone={() =>
              restartEngineRef.current('android render process gone', 'Engine restarted.')
            }
            onContentProcessDidTerminate={() =>
              restartEngineRef.current('ios content process terminated', 'Engine restarted.')
            }
          />
        ) : null}
      </View>
    </EngineContext.Provider>
  );
}

function notReadyMessage(state: EngineState): string {
  switch (state) {
    case 'downloading':
      return 'The model is still downloading.';
    case 'initializing':
    case 'warming':
      return 'The model is still warming up.';
    case 'processing':
      return 'Already working on an image.';
    case 'cold':
      return 'The model is not on this device yet.';
    default:
      return 'The engine is not ready.';
  }
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: -2,
    top: -2,
    width: 1,
    height: 1,
    opacity: 0,
  },
});
