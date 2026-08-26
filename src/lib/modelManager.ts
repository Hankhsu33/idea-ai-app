import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import {
  createDownloadResumable,
  type DownloadPauseState,
  type DownloadProgressData,
  type DownloadResumable,
} from 'expo-file-system/legacy';

import { MANAGED_FILES, findManagedFile, resolveUnknown, TOTAL_EXPECTED_BYTES } from './manifest';
import type { DownloadProgressSnapshot, ManagedFile, ModelStatus } from './types';

const RESUME_KEY = 'bgone.download.resume.v1';
const COMPLETED_KEY = 'bgone.model.completedAt.v1';

/** Raised when the user cancels; not a failure worth showing as one. */
export class DownloadCancelled extends Error {
  constructor() {
    super('download cancelled');
    this.name = 'DownloadCancelled';
  }
}

export interface OpenFile {
  size: number;
  read(length: number): Uint8Array;
  close(): void;
}

type ProgressListener = (snapshot: DownloadProgressSnapshot) => void;

/**
 * Owns the model files on disk.
 *
 * Everything lives under <documentDirectory>/models/rmbg/. The document directory is
 * the one location that survives app restarts and is never reclaimed by the OS, which
 * is the whole reason the model lives here rather than in the WebView's cache.
 *
 * Two APIs are in play on purpose:
 *   - the modern `File`/`Directory`/`Paths` classes for layout, sizes and chunked reads
 *   - `expo-file-system/legacy` for `createDownloadResumable`, which is the only API in
 *     SDK 54 that offers progress plus pause/resume plus a serialisable resume token
 */
class ModelManager {
  private readonly dirPath = ['models', 'rmbg'] as const;

  private task: DownloadResumable | null = null;
  private taskFileName: string | null = null;
  private cancelled = false;
  private paused = false;
  private deleting = false;
  private inFlight: Promise<void> | null = null;

  /** Progress is only allowed to move forwards within one run. */
  private highWater = 0;

  /** name -> in-flight on-demand fetch, so concurrent callers share one download. */
  private ensuring = new Map<string, Promise<File>>();

  private listeners = new Set<ProgressListener>();

  /* --------------------------------------------------------------- *
   * Layout
   * --------------------------------------------------------------- */

  /** `Paths.document` is a getter that mints a new Directory, so never cache one. */
  private get dir(): Directory {
    return new Directory(Paths.document, ...this.dirPath);
  }

  ensureDir(): void {
    const directory = this.dir;
    if (!directory.exists) {
      directory.create({ intermediates: true, idempotent: true });
    }
  }

  fileFor(name: string): File {
    return new File(this.dir, name);
  }

  /** A file counts as present only if its size is right; a truncated download is not. */
  private isValid(spec: ManagedFile): boolean {
    const file = this.fileFor(spec.name);
    if (!file.exists) return false;
    const size = file.size;
    if (size < spec.minSize) return false;
    if (spec.expectedSize !== null && size !== spec.expectedSize) return false;
    return true;
  }

  async getStatus(): Promise<ModelStatus> {
    this.ensureDir();

    const files = MANAGED_FILES.map((spec) => {
      const file = this.fileFor(spec.name);
      return {
        name: spec.name,
        label: spec.label,
        present: this.isValid(spec),
        size: file.exists ? file.size : 0,
        expectedSize: spec.expectedSize,
      };
    });

    const bytesOnDisk = files.reduce((n, f) => n + f.size, 0);
    const allPresent = files.every((f) => f.present);

    let completedAt: number | null = null;
    if (allPresent) {
      const raw = await AsyncStorage.getItem(COMPLETED_KEY);
      completedAt = raw ? Number(raw) : null;
      if (!completedAt) {
        completedAt = Date.now();
        await AsyncStorage.setItem(COMPLETED_KEY, String(completedAt));
      }
    }

    const phase: ModelStatus['phase'] = this.inFlight
      ? 'downloading'
      : allPresent
        ? 'ready'
        : bytesOnDisk > 0
          ? 'partial'
          : 'absent';

    return { phase, bytesOnDisk, bytesExpected: TOTAL_EXPECTED_BYTES, completedAt, files };
  }

  /**
   * name -> byte length for every file currently on disk.
   *
   * Handed to the page so it can validate its own cached copies: a cache entry whose
   * length does not match what we hold is discarded rather than fed to the model.
   */
  sizeMap(): Record<string, number> {
    this.ensureDir();
    const map: Record<string, number> = {};
    for (const spec of MANAGED_FILES) {
      const file = this.fileFor(spec.name);
      if (file.exists) map[spec.name] = file.size;
    }
    return map;
  }

  async isReady(): Promise<boolean> {
    this.ensureDir();
    return MANAGED_FILES.every((spec) => this.isValid(spec));
  }

  /* --------------------------------------------------------------- *
   * Progress fan-out
   * --------------------------------------------------------------- */

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(snapshot: DownloadProgressSnapshot): void {
    // A retried file restarts its byte counter at zero; without this the bar would
    // visibly run backwards.
    this.highWater = Math.max(this.highWater, snapshot.bytesDownloaded);
    this.listeners.forEach((listener) => listener({ ...snapshot, bytesDownloaded: this.highWater }));
  }

  /* --------------------------------------------------------------- *
   * Download
   * --------------------------------------------------------------- */

  /**
   * Downloads every missing file. Safe to call concurrently — a second caller joins the
   * run in progress instead of starting a competing set of transfers.
   */
  download(): Promise<void> {
    if (this.inFlight) {
      const current = this.inFlight;

      // Joining a run that is already pausing would resolve immediately with nothing
      // downloaded, and the caller would think the download had finished. Queue behind
      // it instead and start a fresh run once it has unwound.
      if (this.paused) {
        return current.catch(() => undefined).then(() => this.download());
      }
      return current;
    }

    this.cancelled = false;
    this.paused = false;
    this.highWater = 0;

    this.inFlight = this.runDownload().finally(() => {
      this.inFlight = null;
      this.task = null;
      this.taskFileName = null;
    });

    return this.inFlight;
  }

  get isDownloading(): boolean {
    return this.inFlight !== null;
  }

  private async runDownload(): Promise<void> {
    this.ensureDir();

    // Bytes already on disk count towards the total the user sees, so resuming does
    // not make the bar jump back to zero.
    let completedBytes = MANAGED_FILES.filter((spec) => this.isValid(spec)).reduce(
      (n, spec) => n + this.fileFor(spec.name).size,
      0
    );

    for (let index = 0; index < MANAGED_FILES.length; index++) {
      const spec = MANAGED_FILES[index];

      if (this.cancelled) throw new DownloadCancelled();
      if (this.isValid(spec)) continue;

      const before = completedBytes;
      const report = (written: number) =>
        this.emit({
          bytesDownloaded: before + written,
          bytesTotal: TOTAL_EXPECTED_BYTES,
          currentFile: spec.label,
          fileIndex: index,
          fileCount: MANAGED_FILES.length,
        });

      await this.downloadOne(spec, report);
      if (this.paused) return;

      // One retry on a size mismatch: a truncated transfer is far more likely than the
      // published artefact having changed.
      if (!this.isValid(spec)) {
        this.discard(spec.name);
        await this.clearResumeState(spec.name);
        await this.downloadOne(spec, report);
        if (this.paused) return;

        // Failing loudly beats accepting a file `isValid()` will keep rejecting, which
        // would leave the app looping forever on a download that never counts as done.
        // The URLs are pinned to immutable artefacts, so a second mismatch means the
        // bytes really are wrong.
        if (!this.isValid(spec)) {
          const file = this.fileFor(spec.name);
          throw new Error(
            `${spec.label} did not download correctly (${file.exists ? file.size : 0} bytes, expected ${spec.expectedSize ?? '>' + spec.minSize})`
          );
        }
      }

      completedBytes = before + this.fileFor(spec.name).size;
      report(this.fileFor(spec.name).size);
    }

    await AsyncStorage.setItem(COMPLETED_KEY, String(Date.now()));
    await this.clearResumeState();
  }

  private async downloadOne(spec: ManagedFile, onBytes: (written: number) => void): Promise<void> {
    const destinationUri = this.fileFor(spec.name).uri;
    const callback = (data: DownloadProgressData) => onBytes(data.totalBytesWritten);

    const saved = await this.loadResumeState(spec.name);

    // cancel() can land during the await above, when there is no task for it to stop.
    if (this.cancelled) throw new DownloadCancelled();

    const canResume = !!saved && saved.url === spec.url && !!saved.resumeData;

    let task: DownloadResumable;
    if (canResume && saved) {
      task = createDownloadResumable(saved.url, saved.fileUri, saved.options, callback, saved.resumeData);
    } else {
      // No usable resume token, so whatever is on disk is unusable too.
      this.discard(spec.name);
      task = createDownloadResumable(spec.url, destinationUri, {}, callback);
    }

    this.task = task;
    this.taskFileName = spec.name;

    try {
      const result = canResume ? await task.resumeAsync() : await task.downloadAsync();

      // `undefined` means the task stopped without completing — either the user
      // cancelled it or we paused it on the way to the background.
      if (result === undefined) {
        if (this.cancelled) throw new DownloadCancelled();
        this.paused = true;
        return;
      }

      await this.clearResumeState(spec.name);
    } catch (e) {
      if (this.cancelled) throw new DownloadCancelled();
      throw e;
    } finally {
      if (this.task === task) {
        this.task = null;
        this.taskFileName = null;
      }
    }
  }

  /**
   * Called as the app leaves the foreground. Pausing yields a platform resume token
   * that we persist, so a download survives the app being killed while suspended.
   */
  async pauseForBackground(): Promise<void> {
    const task = this.task;
    const name = this.taskFileName;
    if (!task || !name || this.cancelled) return;

    this.paused = true;
    try {
      const state = await task.pauseAsync();
      await this.saveResumeState(name, state);
    } catch (e) {
      this.paused = false;
      console.warn('[bgone] pausing the download failed', e);
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.paused = false;
    const task = this.task;
    if (task) {
      void task.cancelAsync().catch(() => {
        /* already terminal */
      });
    }
    void this.clearResumeState();
  }

  /* --------------------------------------------------------------- *
   * On-demand: a file the page asked for that is not on disk yet
   * --------------------------------------------------------------- */

  ensureFile(name: string, url: string): Promise<File> {
    // Two callers for the same name would truncate and write the same path at once.
    const existing = this.ensuring.get(name);
    if (existing) return existing;

    const run = this.doEnsureFile(name, url).finally(() => {
      this.ensuring.delete(name);
    });
    this.ensuring.set(name, run);
    return run;
  }

  private async doEnsureFile(name: string, url: string): Promise<File> {
    if (this.deleting) throw new Error('the model is being deleted');
    this.ensureDir();

    const spec = findManagedFile(name) ?? resolveUnknown(name, url);
    if (!spec) throw new Error(`refusing to fetch an unrecognised file: ${name}`);

    if (this.isValid(spec)) return this.fileFor(spec.name);

    // Download to a side path and only publish it once it is whole. Writing straight
    // to the served name would let a concurrent read see a half-written file.
    const staging = this.fileFor(`${spec.name}.part`);
    this.discard(staging.name);
    this.discard(spec.name);

    await createDownloadResumable(spec.url, staging.uri, {}).downloadAsync();

    // deleteAll() can have run while that was in flight; do not resurrect the file.
    if (this.deleting) {
      this.discard(staging.name);
      throw new Error('the model is being deleted');
    }

    if (!staging.exists || staging.size < spec.minSize) {
      this.discard(staging.name);
      throw new Error(`${spec.label} could not be downloaded`);
    }

    staging.move(this.fileFor(spec.name));

    const file = this.fileFor(spec.name);
    if (!file.exists || file.size < spec.minSize) {
      throw new Error(`${spec.label} could not be downloaded`);
    }
    return file;
  }

  /* --------------------------------------------------------------- *
   * Reading
   * --------------------------------------------------------------- */

  /** Streams a file in slices, so a 44 MB read never becomes a 44 MB allocation. */
  openForRead(name: string): OpenFile {
    const file = this.fileFor(name);
    if (!file.exists) throw new Error(`${name} is not on disk`);

    // A half-written file exists but is not a file. Serving it would hand the page a
    // truncated model, which fails much further away from the cause.
    const spec = findManagedFile(name);
    if (spec && !this.isValid(spec)) {
      throw new Error(`${name} is incomplete on disk`);
    }

    const size = file.size;
    const handle = file.open();

    return {
      size,
      read: (length: number) => handle.readBytes(length),
      close: () => {
        try {
          handle.close();
        } catch {
          /* already closed */
        }
      },
    };
  }

  /* --------------------------------------------------------------- *
   * Deletion
   * --------------------------------------------------------------- */

  private discard(name: string): void {
    const file = this.fileFor(name);
    if (file.exists) {
      try {
        file.delete();
      } catch (e) {
        console.warn(`[bgone] could not delete ${name}`, e);
      }
    }
  }

  async deleteAll(): Promise<void> {
    this.deleting = true;
    try {
      this.cancel();

      // Let anything still unwinding finish before pulling the directory out from
      // under it, so nothing recreates a file after the delete. `deleting` is already
      // set, so those calls will bail rather than publish what they fetched.
      const pending: Promise<unknown>[] = [...this.ensuring.values()];
      if (this.inFlight) pending.push(this.inFlight);
      await Promise.all(pending.map((p) => p.catch(() => undefined)));

      const directory = this.dir;
      if (directory.exists) {
        try {
          directory.delete();
        } catch (e) {
          console.warn('[bgone] could not delete the model directory', e);
        }
      }
      this.ensureDir();
      await AsyncStorage.multiRemove([COMPLETED_KEY, RESUME_KEY]);
    } finally {
      this.deleting = false;
      this.highWater = 0;
    }
  }

  /* --------------------------------------------------------------- *
   * Resume tokens
   * --------------------------------------------------------------- */

  private async loadResumeState(name: string): Promise<DownloadPauseState | null> {
    try {
      const raw = await AsyncStorage.getItem(RESUME_KEY);
      if (!raw) return null;
      const all = JSON.parse(raw) as Record<string, DownloadPauseState>;
      return all[name] ?? null;
    } catch {
      return null;
    }
  }

  private async saveResumeState(name: string, state: DownloadPauseState): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(RESUME_KEY);
      const all = raw ? (JSON.parse(raw) as Record<string, DownloadPauseState>) : {};
      all[name] = state;
      await AsyncStorage.setItem(RESUME_KEY, JSON.stringify(all));
    } catch (e) {
      console.warn('[bgone] could not persist the resume token', e);
    }
  }

  private async clearResumeState(name?: string): Promise<void> {
    try {
      if (!name) {
        await AsyncStorage.removeItem(RESUME_KEY);
        return;
      }
      const raw = await AsyncStorage.getItem(RESUME_KEY);
      if (!raw) return;
      const all = JSON.parse(raw) as Record<string, DownloadPauseState>;
      delete all[name];
      await AsyncStorage.setItem(RESUME_KEY, JSON.stringify(all));
    } catch {
      /* best effort */
    }
  }
}

export const modelManager = new ModelManager();
