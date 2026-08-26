import { Platform } from 'react-native';

import type { ManagedFile } from './types';

/**
 * Everything the engine needs, pinned. These are all immutable artefacts — an npm
 * version on jsDelivr and a git revision on the Hugging Face Hub — so the byte sizes
 * below are exact and double as an integrity check.
 *
 * If the page ever asks for a file that is not in this list (because a future
 * Transformers.js picks a different wasm variant, say), ModelManager falls back to
 * downloading it on demand and the app keeps working. See `resolveUnknown`.
 */
export const TRANSFORMERS_VERSION = '4.2.0';

/** The onnxruntime-web version that @huggingface/transformers 4.2.0 depends on. */
export const ORT_VERSION = '1.26.0-dev.20260416-b7804b056c';

export const MODEL_REPO = 'briaai/RMBG-1.4';

/**
 * Pinned to a commit rather than `main`.
 *
 * The byte sizes below double as the integrity check, so the bytes behind these URLs
 * must never change. `resolve/main/` follows the branch: if BRIA ever re-exported the
 * ONNX file, every installation would start failing verification at once.
 */
export const MODEL_REVISION = '2ceba5a5efaec153162aedea169f76caf9b46cf8';

const HF = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/`;
const NPM = 'https://cdn.jsdelivr.net/npm/';

/**
 * Transformers.js picks the wasm build per browser: Safari gets the plain SIMD build,
 * everything else gets the asyncify build (src/backends/onnx.js). An iOS WebView is
 * Safari and an Android WebView is Chromium, so platform is a faithful proxy.
 */
const IS_SAFARI_WEBVIEW = Platform.OS === 'ios';

const ORT_BASE = `${NPM}onnxruntime-web@${ORT_VERSION}/dist/`;

const ORT_FILES: ManagedFile[] = IS_SAFARI_WEBVIEW
  ? [
      {
        name: 'ort-wasm-simd-threaded.mjs',
        url: `${ORT_BASE}ort-wasm-simd-threaded.mjs`,
        expectedSize: 24180,
        minSize: 8000,
        label: 'ONNX Runtime loader',
      },
      {
        name: 'ort-wasm-simd-threaded.wasm',
        url: `${ORT_BASE}ort-wasm-simd-threaded.wasm`,
        expectedSize: 12942611,
        minSize: 4000000,
        label: 'ONNX Runtime',
      },
    ]
  : [
      {
        name: 'ort-wasm-simd-threaded.asyncify.mjs',
        url: `${ORT_BASE}ort-wasm-simd-threaded.asyncify.mjs`,
        expectedSize: 47389,
        minSize: 8000,
        label: 'ONNX Runtime loader',
      },
      {
        name: 'ort-wasm-simd-threaded.asyncify.wasm',
        url: `${ORT_BASE}ort-wasm-simd-threaded.asyncify.wasm`,
        expectedSize: 23567050,
        minSize: 4000000,
        label: 'ONNX Runtime',
      },
    ];

/** The weights, the only file the user thinks of as "the model". */
export const MODEL_WEIGHTS: ManagedFile = {
  name: 'model_quantized.onnx',
  url: `${HF}onnx/model_quantized.onnx`,
  expectedSize: 44403226,
  minSize: 40000000,
  label: 'RMBG-1.4 weights (8-bit)',
};

export const MANAGED_FILES: ManagedFile[] = [
  {
    name: 'transformers.min.js',
    url: `${NPM}@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/transformers.min.js`,
    expectedSize: 558373,
    minSize: 200000,
    label: 'Transformers.js',
  },
  ...ORT_FILES,
  MODEL_WEIGHTS,
  // Passed inline by the page too (matching the official RMBG recipe), but kept on disk
  // so a future Transformers.js that insists on reading them still works offline.
  {
    name: 'config.json',
    url: `${HF}config.json`,
    expectedSize: 548,
    minSize: 100,
    label: 'Model config',
  },
  {
    name: 'preprocessor_config.json',
    url: `${HF}preprocessor_config.json`,
    expectedSize: 345,
    minSize: 100,
    label: 'Preprocessor config',
  },
];

export const TOTAL_EXPECTED_BYTES = MANAGED_FILES.reduce((n, f) => n + (f.expectedSize ?? 0), 0);

export function findManagedFile(name: string): ManagedFile | undefined {
  return MANAGED_FILES.find((f) => f.name === name);
}

/**
 * A file the page asked for that is not in the pinned list. We can still serve it as
 * long as we are online; it just is not part of the advertised download size.
 */
export function resolveUnknown(name: string, url: string): ManagedFile | null {
  if (!/^https:\/\/(cdn\.jsdelivr\.net|huggingface\.co)\//.test(url)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return { name, url, expectedSize: null, minSize: 1, label: name };
}
