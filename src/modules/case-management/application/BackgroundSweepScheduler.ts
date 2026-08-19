export interface BackgroundSweepStatus {
  readonly running: boolean;
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
  readonly lastResult: Record<string, number> | null;
}

export interface BackgroundSweepSchedulerOptions {
  readonly name: string;
  readonly run: () => Promise<Record<string, number>>;
  /** Periodo entre pases. `0` deja el barrido en manos del disparo manual. */
  readonly intervalSeconds: number;
  /** Margen tras el arranque, para no competir con el boot. */
  readonly initialDelayMs?: number;
}

/**
 * Planificador de un barrido periodico, compartido por el reloj de SLA y el
 * publicador del outbox.
 *
 * De un solo vuelo, igual que `DirectorySyncScheduler`: si un pase sigue en
 * curso cuando toca el siguiente, el segundo se engancha al primero en lugar
 * de arrancar en paralelo. Dos barridos de SLA solapados se pisarian al
 * avanzar la misma fila y podrian emitir el aviso por duplicado.
 *
 * Un fallo NUNCA propaga fuera del temporizador. Una excepcion sin capturar
 * dentro de un callback de `setInterval` derriba el proceso entero en Node, de
 * modo que un mal pase del barrido tumbaria toda la API.
 */
export class BackgroundSweepScheduler {
  private inFlight: Promise<Record<string, number>> | null = null;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private lastResult: Record<string, number> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: BackgroundSweepSchedulerOptions) {}

  get status(): BackgroundSweepStatus {
    return {
      running: this.inFlight !== null,
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      lastResult: this.lastResult,
    };
  }

  /** Lanza un pase, o devuelve el que ya estuviera en curso. */
  run(): Promise<Record<string, number>> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        const result = await this.options.run();
        this.lastResult = result;
        this.lastError = null;
        return result;
      } catch (error) {
        this.lastError = (error as Error).message;
        console.warn(`[${this.options.name}] el pase fallo: ${this.lastError}`);
        return {};
      } finally {
        this.lastRunAt = new Date().toISOString();
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  start(): void {
    if (this.options.intervalSeconds <= 0 || this.timer) return;

    const delay = this.options.initialDelayMs ?? 15_000;
    setTimeout(() => void this.run(), delay).unref?.();

    this.timer = setInterval(() => void this.run(), this.options.intervalSeconds * 1000);
    // `unref` para que un temporizador pendiente no impida al proceso terminar
    // durante los tests ni en un apagado ordenado.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
