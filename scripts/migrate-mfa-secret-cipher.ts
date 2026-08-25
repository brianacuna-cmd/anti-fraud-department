/**
 * Re-cifra los secretos TOTP con el `TOKEN_SECRET` actual.
 *
 * POR QUÉ EXISTE
 *
 * `TOKEN_SECRET` cifra los secretos MFA con AES-GCM. Cambiarlo —lo que hay que
 * hacer sí o sí, porque el valor por defecto está escrito en el repositorio—
 * deja ilegibles los secretos ya guardados: `decrypt` devuelve `null` y
 * `IssueSession` rechaza el login. El usuario queda fuera sin ningún mensaje
 * que explique la causa.
 *
 * Este script recorre los usuarios y deja cada secreto legible con la clave
 * actual. Cubre tres situaciones:
 *
 *   1. Ya cifrado con la clave NUEVA  → no se toca.
 *   2. Cifrado con una clave ANTERIOR → se descifra y se vuelve a cifrar.
 *   3. En claro (base32, formato previo a que existiera el cifrado) → se
 *      cifra. Estos secretos ya estaban rotos antes de cualquier rotación:
 *      `decrypt` sobre texto en claro también devuelve `null`.
 *
 * USO
 *
 *   TOKEN_SECRET=<el nuevo> \
 *   OLD_TOKEN_SECRET=<el anterior> \
 *   pnpm tsx scripts/migrate-mfa-secret-cipher.ts [--apply]
 *
 * Sin `--apply` no escribe nada: enumera lo que haría. Ese es el modo por
 * defecto a propósito — un script que toca credenciales no debe modificar
 * nada la primera vez que alguien lo ejecuta para ver qué hace.
 *
 * `OLD_TOKEN_SECRET` puede omitirse; entonces se prueba el valor por defecto
 * del código, que es el caso habitual: pasar de «nunca se configuró» a un
 * secreto de verdad.
 */

import { MongoClient } from 'mongodb';
import { AesGcmSecretCipher } from '../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';

/** El mismo literal al que cae `main.ts` cuando la variable no está definida. */
const CODE_DEFAULT_SECRET = 'dev-only-insecure-token-secret';

/** Un secreto TOTP en claro: base32 en mayúsculas, sin relleno. */
const LOOKS_LIKE_PLAINTEXT_BASE32 = /^[A-Z2-7]{16,64}$/;

interface Outcome {
  readonly email: string;
  readonly action: 'ya-legible' | 're-cifrado' | 'cifrado-desde-claro' | 'IRRECUPERABLE';
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
  const dbName = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';

  const currentSecret = process.env.TOKEN_SECRET;
  if (currentSecret === undefined || currentSecret.trim() === '') {
    throw new Error('Falta TOKEN_SECRET: es la clave con la que se va a re-cifrar.');
  }
  const keyVersion = Number(process.env.TOKEN_KEY_VERSION ?? 1);

  const current = new AesGcmSecretCipher(currentSecret, keyVersion);
  // Se prueban en orden: la clave anterior declarada y, si no, el valor por
  // defecto del codigo. Casi siempre el caso real es el segundo.
  const previous = [process.env.OLD_TOKEN_SECRET, CODE_DEFAULT_SECRET]
    .filter((s): s is string => s !== undefined && s.trim() !== '')
    .map((s) => new AesGcmSecretCipher(s, keyVersion));

  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const users = client.db(dbName).collection('users');
    const withMfa = await users.find({ 'mfa.secret': { $ne: null } }).toArray();
    const outcomes: Outcome[] = [];

    for (const user of withMfa) {
      const email = String(user.email ?? user._id);
      const stored = user.mfa?.secret;
      if (typeof stored !== 'string' || stored === '') {
        continue;
      }

      if (current.decrypt(stored) !== null) {
        outcomes.push({ email, action: 'ya-legible' });
        continue;
      }

      const recovered = previous.map((cipher) => cipher.decrypt(stored)).find((v) => v !== null);
      if (recovered !== undefined && recovered !== null) {
        if (apply) {
          await users.updateOne({ _id: user._id }, { $set: { 'mfa.secret': current.encrypt(recovered) } });
        }
        outcomes.push({ email, action: 're-cifrado' });
        continue;
      }

      if (LOOKS_LIKE_PLAINTEXT_BASE32.test(stored)) {
        if (apply) {
          await users.updateOne({ _id: user._id }, { $set: { 'mfa.secret': current.encrypt(stored) } });
        }
        outcomes.push({ email, action: 'cifrado-desde-claro' });
        continue;
      }

      outcomes.push({ email, action: 'IRRECUPERABLE' });
    }

    report(outcomes, apply);
  } finally {
    await client.close();
  }
}

function report(outcomes: readonly Outcome[], apply: boolean): void {
  console.log(apply ? '\nAPLICADO\n' : '\nSIMULACION — no se ha escrito nada (usa --apply)\n');
  for (const { email, action } of outcomes) {
    console.log(`  ${action.padEnd(20)} ${email}`);
  }

  const rotos = outcomes.filter((o) => o.action === 'IRRECUPERABLE');
  console.log(`\n  ${outcomes.length} usuarios con MFA`);

  if (rotos.length > 0) {
    console.log(
      `\n  ${rotos.length} secreto(s) que ninguna clave conocida descifra. Esos usuarios\n` +
        '  tienen que volver a enrolar el MFA: no hay forma de recuperar el\n' +
        '  secreto original, y eso es exactamente lo que se espera de AES-GCM.',
    );
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
