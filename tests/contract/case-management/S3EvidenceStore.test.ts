import type { S3Client } from '@aws-sdk/client-s3';
import { S3EvidenceStore } from '../../../src/modules/case-management/infrastructure/adapters/outbound/storage/S3EvidenceStore.js';

interface SentCommand {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/**
 * `S3Client` falso: registra los comandos y responde lo que se le diga. Evita
 * red y credenciales, que es justo lo que no debe hacer falta para comprobar
 * que las claves y los prefijos se componen bien.
 */
function fakeClient(behaviour: {
  body?: string;
  error?: unknown;
}): { client: S3Client; sent: SentCommand[] } {
  const sent: SentCommand[] = [];
  const client = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (behaviour.error !== undefined) {
        throw behaviour.error;
      }
      if (behaviour.body === undefined) {
        return {};
      }
      return {
        Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(behaviour.body!)) },
      };
    },
  } as unknown as S3Client;
  return { client, sent };
}

const BASE = { bucket: 'evidencias', region: 'us-east-1' };

describe('S3EvidenceStore', () => {
  it('sube el blob con su content type', async () => {
    const { client, sent } = fakeClient({});
    const store = new S3EvidenceStore({ ...BASE, client });

    await store.put('org/case/ev-1', Buffer.from('bytes'), 'application/pdf');

    expect(sent[0]!.name).toBe('PutObjectCommand');
    expect(sent[0]!.input).toMatchObject({
      Bucket: 'evidencias',
      Key: 'org/case/ev-1',
      ContentType: 'application/pdf',
    });
  });

  it('antepone el prefijo, normalizando las barras sobrantes', async () => {
    const { client, sent } = fakeClient({});
    const store = new S3EvidenceStore({ ...BASE, prefix: '/prod/', client });

    await store.put('org/case/ev-1', Buffer.from('bytes'));

    // Without normalizing, `/prod/` would give `/prod//org/...` and the real
    // object key would not match the one signed on download.
    expect(sent[0]!.input.Key).toBe('prod/org/case/ev-1');
  });

  it('descarga el blob', async () => {
    const { client } = fakeClient({ body: 'contenido' });
    const store = new S3EvidenceStore({ ...BASE, client });

    const bytes = await store.get('org/case/ev-1');

    expect(bytes!.toString()).toBe('contenido');
  });

  it('devuelve null cuando el objeto no existe', async () => {
    const { client } = fakeClient({ error: Object.assign(new Error('missing'), { name: 'NoSuchKey' }) });
    const store = new S3EvidenceStore({ ...BASE, client });

    expect(await store.get('org/case/ev-1')).toBeNull();
  });

  it('trata AccessDenied con 404 como ausencia, igual que el filesystem con ENOENT', async () => {
    // Un bucket sin permiso de ListBucket responde asi en vez de NoSuchKey.
    const { client } = fakeClient({
      error: Object.assign(new Error('denied'), { $metadata: { httpStatusCode: 404 } }),
    });
    const store = new S3EvidenceStore({ ...BASE, client });

    expect(await store.get('org/case/ev-1')).toBeNull();
  });

  it('propaga los errores que NO son ausencia', async () => {
    // Un fallo de red no puede confundirse con "esta evidencia no existe".
    const { client } = fakeClient({
      error: Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }),
    });
    const store = new S3EvidenceStore({ ...BASE, client });

    await expect(store.get('org/case/ev-1')).rejects.toThrow('boom');
  });

  it('expone presignDownload, que es lo que el filesystem no puede', () => {
    const { client } = fakeClient({});
    const store = new S3EvidenceStore({ ...BASE, client });

    expect(typeof store.presignDownload).toBe('function');
  });
});
