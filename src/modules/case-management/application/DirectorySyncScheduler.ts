import type { createSyncFinturuDirectoryUseCase } from './SyncFinturuDirectory.js';

export interface DirectorySyncStatus {
  /** Hay un refresco en curso ahora mismo. */
  readonly running: boolean;
  readonly lastError: string | null;
  readonly lastDurationMs: number | null;
}

export interface DirectorySyncSchedulerOptions {
  readonly syncDirectory: ReturnType<typeof createSyncFinturuDirectoryUseCase>;
  /** Periodo entre refrescos. `0` deja el directorio en manos del endpoint manual. */
  readonly intervalMinutes: number;
  /** Margen tras el arranque antes del primer pase, para no competir con el boot. */
  readonly initialDelayMs?: number;
}

/**
 * Mantiene el directorio al día sin que nadie tenga que pedirlo.
 *
 * Un refresco tarda minutos, así que dos solapados serían puro desperdicio
 * compitiendo por la misma API lenta: `start` es de un solo vuelo — si ya hay
 * uno corriendo, la siguiente petición se engancha a él en lugar de lanzar otro.
 * Ese mismo estado es el que la interfaz consulta para decir "sincronizando" en
 * vez de "no hay clientes" mientras se llena por primera vez.
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

  /** Lanza un refresco, o devuelve el que ya estuviera en curso. */
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
