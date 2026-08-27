import type { createSyncFinturuDirectoryUseCase } from './SyncFinturuDirectory.js';

export interface DirectorySyncStatus {
  /** There is a refresh in progress right now. */
  readonly running: boolean;
  readonly lastError: string | null;
  readonly lastDurationMs: number | null;
}

export interface DirectorySyncSchedulerOptions {
  readonly syncDirectory: ReturnType<typeof createSyncFinturuDirectoryUseCase>;
  /** Period between refreshes. `0` leaves the directory in the hands of the manual endpoint. */
  readonly intervalMinutes: number;
  /** Margin after startup before the first pass, so it does not compete with boot. */
  readonly initialDelayMs?: number;
}

/**
 * Keeps the directory up to date without anyone having to ask for it.
 *
 * A refresh takes minutes, so two overlapping ones would be pure waste
 * competing for the same slow API: `start` is single-flight — if one is
 * already running, the next request attaches to it instead of launching
 * another. That same state is what the UI consults to say "syncing"
 * instead of "there are no customers" while it fills for the first time.
 */
export class DirectorySyncScheduler {
  private inFlight: Promise<void> | null = null;
  private lastError: string | null = null;
  private lastDurationMs: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: DirectorySyncSchedulerOptions) {}

  get status(): DirectorySyncStatus {
    return {
      running: this.inFlight !== null,
      lastError: this.lastError,
      lastDurationMs: this.lastDurationMs,
    };
  }

  /** Starts a refresh, or returns the one that was already in progress. */
  run(): Promise<void> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        const result = await this.options.syncDirectory();
        this.lastError = null;
        this.lastDurationMs = result.durationMs;
        console.log(`[directorio] ${result.total} clientes sincronizados en ${Math.round(result.durationMs / 1000)} s`);
      } catch (error) {
        this.lastError = (error as Error).message;
        console.error('[directorio] el sync falló:', this.lastError);
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  start(): void {
    const { intervalMinutes, initialDelayMs = 5_000 } = this.options;
    if (intervalMinutes <= 0) {
      console.log('[directorio] sync automático desactivado');
      return;
    }

    setTimeout(() => void this.run(), initialDelayMs).unref();
    this.timer = setInterval(() => void this.run(), intervalMinutes * 60_000);
    this.timer.unref();
    console.log(`[directorio] sync automático cada ${intervalMinutes} min`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
