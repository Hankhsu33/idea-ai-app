/** Which ONNX execution provider the WebView actually managed to initialise. */
export type Backend = 'webgpu' | 'wasm';

/**
 * Square edge the model runs at.
 *
 * RMBG-1.4's graph has symbolic spatial axes, so this is a real dial rather than a
 * fixed property of the export. Cost is roughly quadratic: 512 is about a quarter of
 * the work of 1024. Must stay a multiple of 32 — the U-net halves six times.
 */
export type Resolution = 512 | 768 | 1024;

export const RESOLUTIONS: Resolution[] = [512, 768, 1024];

/* ------------------------------------------------------------------ *
 * RN -> WebView. Everything is delivered with injectJavaScript, calling
 * either window.__BGONE_RECV(json) or window.__BGONE_CHUNK(id, i, b64).
 * ------------------------------------------------------------------ */

export type ToPageMessage =
  /** Header for a file transfer: lets the page allocate the buffer once. */
  | { id: string; type: 'fileMeta'; payload: { requestId: string; size: number } }
  /** The requested file cannot be served (missing on disk, deleted mid-flight, offline). */
  | { id: string; type: 'fileError'; payload: { requestId: string; message: string } }
  /** Load the library, pick a backend, load the model, run one dummy inference. */
  | {
      id: string;
      type: 'warm';
      payload: {
        forceWasm: boolean;
        /** Square edge the model runs at. */
        size: Resolution;
        /** name -> byte length, so the page can validate its own cached copies. */
        manifest: Record<string, number>;
      };
    }
  /** Rebuild the processor at a new working resolution. Keeps the loaded session. */
  | { id: string; type: 'setResolution'; payload: { size: Resolution } }
  /** Run background removal. `id` is the job id the reply must echo. */
  | { id: string; type: 'process'; payload: { imageBase64: string; mimeType: string } }
  /** Liveness check. */
  | { id: string; type: 'ping' }
  /** Drop the session so the model files can be deleted. */
  | { id: string; type: 'unload' };

/* ------------------------------------------------------------------ *
 * WebView -> RN (window.ReactNativeWebView.postMessage, JSON)
 * ------------------------------------------------------------------ */

export type ProgressStage = 'transfer' | 'compile' | 'preprocess' | 'infer' | 'compose';

export interface ProgressPayload {
  stage: ProgressStage;
  /** 0..1, or null when indeterminate. */
  ratio: number | null;
  detail?: string;
}

export interface ResultPayload {
  /** Number of `resultChunk` messages that carry the PNG. */
  chunks: number;
  width: number;
  height: number;
  /** Square edge the model ran at, so a timing can be attributed to a setting. */
  size: number;
  /** Pure model forward-pass time. */
  inferenceMs: number;
  /** Decode + preprocess + infer + composite. */
  totalMs: number;
  backend: Backend;
}

export type FromPageMessage =
  /** Page JS booted and its listeners are installed. */
  | {
      id: string;
      type: 'ready';
      payload: { userAgent: string; hasWebGPU: boolean; secureContext: boolean; origin: string };
    }
  /** The page needs the bytes of a file; `name` is the basename it matched on. */
  | { id: string; type: 'fileRequest'; payload: { requestId: string; name: string; url: string } }
  /** Reported once the library is configured — used to sanity-check the pinned asset list. */
  | {
      id: string;
      type: 'runtime';
      payload: { transformers: string; ort: string | null; wasmPaths: { mjs?: string; wasm?: string } | null };
    }
  | { id: string; type: 'progress'; payload: ProgressPayload }
  | { id: string; type: 'warmed'; payload: { backend: Backend; ms: number } }
  /**
   * WebGPU could not initialise. ONNX Runtime caches its backend initialisation, so a
   * failed attempt poisons WASM in the same page — the page needs replacing, not
   * retrying. Not an error: start-up continues on the fresh page.
   */
  | { id: string; type: 'needsWasmRestart'; payload: { reason: string } }
  | { id: string; type: 'resultChunk'; payload: { index: number; total: number; data: string } }
  | { id: string; type: 'result'; payload: ResultPayload }
  | { id: string; type: 'pong'; payload: { busy: boolean; hasModel: boolean } }
  | { id: string; type: 'unloaded'; payload: Record<string, never> }
  | { id: string; type: 'error'; payload: { message: string; fatal: boolean } }
  | { id: string; type: 'log'; payload: { line: string } };

/* ------------------------------------------------------------------ *
 * Engine state machine
 * ------------------------------------------------------------------ */

export type EngineState =
  /** Nothing started yet. */
  | 'cold'
  /** Fetching model + runtime files into the app's document directory. */
  | 'downloading'
  /** WebView booting, library loading, bytes crossing the bridge. */
  | 'initializing'
  /** Model loaded, running the dummy inference. */
  | 'warming'
  /** Idle and able to accept work. */
  | 'ready'
  /** An image is being processed. */
  | 'processing'
  | 'download_failed'
  | 'engine_failed'
  | 'inference_failed'
  | 'inference_timeout';

export const TERMINAL_ERROR_STATES: EngineState[] = [
  'download_failed',
  'engine_failed',
  'inference_failed',
  'inference_timeout',
];

export interface EngineError {
  /** One plain sentence. No error codes. */
  message: string;
  action: 'retry' | 'settings' | 'none';
}

/* ------------------------------------------------------------------ *
 * Model files on disk
 * ------------------------------------------------------------------ */

export interface ManagedFile {
  /** Basename used as the on-disk name and as the key the page matches on. */
  name: string;
  url: string;
  /** Exact size when the server publishes a stable one, otherwise null. */
  expectedSize: number | null;
  /** Anything smaller than this is certainly a truncated or error-page download. */
  minSize: number;
  label: string;
}

export type ModelPhase = 'absent' | 'partial' | 'downloading' | 'ready';

export interface ModelStatus {
  phase: ModelPhase;
  /** Bytes present on disk across all managed files. */
  bytesOnDisk: number;
  /** Best known total for all managed files. */
  bytesExpected: number;
  /** Set once every file has been verified present and correctly sized. */
  completedAt: number | null;
  /** Per-file detail, for Settings. */
  files: { name: string; label: string; present: boolean; size: number; expectedSize: number | null }[];
}

export interface DownloadProgressSnapshot {
  bytesDownloaded: number;
  bytesTotal: number;
  currentFile: string;
  fileIndex: number;
  fileCount: number;
}

/* ------------------------------------------------------------------ *
 * Gallery
 * ------------------------------------------------------------------ */

export interface GalleryItem {
  id: string;
  /** File name inside <documentDirectory>/cutouts/. Stored as a name rather than a
   *  full URI because the app container path can change between launches on iOS. */
  fileName: string;
  createdAt: number;
  width: number;
  height: number;
  inferenceMs: number;
  backend: Backend;
}
