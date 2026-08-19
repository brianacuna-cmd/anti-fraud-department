import { unknownChannel } from '../../errors/NotificationsError.js';

/**
 * Closed catalog of notification channels (design D2). Not branded — a
 * closed enum, not an opaque id.
 *
 * `IN_APP` es la bandeja dentro del panel; `EMAIL` sale del sistema. Se
 * modelan como canales distintos y no como un unico "notificar" porque el
 * usuario decide por separado: querer ver un aviso al abrir el panel no
 * implica querer un correo por cada uno.
 */
export type NotificationChannel = 'EMAIL' | 'IN_APP';

/** Catalogo completo, usado para validar. */
export const CHANNELS = ['EMAIL', 'IN_APP'] as const;

/**
 * Canales que el usuario puede apagar.
 *
 * `IN_APP` queda deliberadamente FUERA: la bandeja del panel entrega siempre.
 * Poder silenciarla significaria que a un analista se le asigna un expediente
 * y no queda constancia de que se le aviso — un agujero de responsabilidad en
 * un departamento antifraude, donde "no me enteré" tiene que ser verificable.
 * El correo si es configurable, porque es el canal intrusivo y el que la gente
 * quiere acotar.
 */
export const CONFIGURABLE_CHANNELS = ['EMAIL'] as const;

const VALID_CHANNELS: ReadonlySet<string> = new Set<NotificationChannel>(CHANNELS);

export function createNotificationChannel(value: string): NotificationChannel {
  if (!VALID_CHANNELS.has(value)) {
    throw unknownChannel(value);
  }
  return value as NotificationChannel;
}
