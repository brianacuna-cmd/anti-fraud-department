import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { AuthContext } from '../kernel/AuthContext.js';

/**
 * Quién está actuando, accesible desde capas que NO reciben la petición.
 *
 * Existe por una necesidad muy concreta: el registro de cambios campo a campo
 * (AUD-001) decora un repositorio que se construye UNA VEZ al arrancar, y el
 * actor cambia en cada petición. Las alternativas eran peores:
 *
 *  - Pasar el `AuthContext` como parámetro a `save()` obligaría a cambiar el
 *    puerto `CaseRepository` y los treinta sitios que lo llaman, para que
 *    todos acarreen un dato que solo usa la auditoría.
 *  - Construir el repositorio por petición desarmaría la composición entera.
 *
 * `AsyncLocalStorage` mantiene el valor a través de los `await` de una misma
 * petición sin que las capas intermedias sepan que existe. Es la herramienta
 * correcta para esto y también fácil de usar mal: NO es un sitio donde meter
 * estado de aplicación. Aquí solo vive el actor, de lectura.
 *
 * Fuera de una petición —un cron, un worker— devuelve `null`, y quien lo lee
 * debe estar preparado para eso en vez de asumir que siempre hay alguien.
 */
const storage = new AsyncLocalStorage<AuthContext>();

/** Middleware: publica el actor ya resuelto para el resto de la petición. */
export function authContextStoreMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.authContext;
  if (auth === undefined) {
    next();
    return;
  }
  storage.run(auth, () => next());
}

/** El actor de la petición en curso, o `null` fuera de una. */
export function currentAuthContext(): AuthContext | null {
  return storage.getStore() ?? null;
}
