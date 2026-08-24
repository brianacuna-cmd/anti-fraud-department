/**
 * Siembra un escenario de demostración y lo recorre por la API real.
 *
 * QUÉ HACE Y QUÉ NO
 *
 * La IDENTIDAD (organización, roles, tres usuarios) se escribe directa en
 * Mongo: crearla por API exige una sesión de Super Admin, que a su vez exige
 * un OTP por correo, y eso no se puede automatizar.
 *
 * Todo lo demás —abrir el expediente, asignarlo, revisarlo, instruirlo,
 * dictaminar, pedir la medida y firmarla— va por HTTP contra el servidor que
 * esté corriendo. Es deliberado: sembrar los casos a mano en la base saltaría
 * exactamente las reglas que queremos comprobar (la puerta de asignación, el
 * reparto solo-ADMIN, los cuatro ojos) y dejaría datos que el dominio nunca
 * habría permitido crear.
 *
 * Los usuarios nacen con MFA activo y un secreto que este script conoce, para
 * poder generar sus códigos: el login SIEMPRE pasa por MFA, sea reto o
 * enrolamiento, así que no hay atajo sin secreto.
 *
 * USO
 *   pnpm tsx --env-file-if-exists=.env scripts/seed-demo.ts
 *
 * Requiere el servidor levantado en PORT (3100 por defecto).
 */

import { MongoClient, ObjectId } from 'mongodb';
import { hash } from 'bcryptjs';
import { authenticator } from 'otplib';
import { AesGcmSecretCipher } from '../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';

const API = `http://localhost:${process.env.PORT ?? 3100}/api/v1`;
// NOSONAR (S2068): contrasena de los usuarios de demostracion que crea este
// script en la base local. No es una credencial de ningun entorno real;
// se puede sustituir por SEED_DEMO_PASSWORD para no depender del literal.
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo1234!'; // NOSONAR
/**
 * Organización propia. NO se siembra dentro de la del usuario: el aislamiento
 * por inquilino es lo que hace que estos datos de demostración no aparezcan
 * mezclados con los reales en ninguna consulta.
 */
const SLUG = 'demo';

interface Person {
  readonly key: 'admin' | 'analyst' | 'supervisor';
  readonly email: string;
  readonly first: string;
  readonly last: string;
  readonly role: string;
  secret?: string;
  token?: string;
  id?: string;
}

const PEOPLE: Person[] = [
  { key: 'admin', email: 'admin.demo@finturu.com', first: 'Ana', last: 'Reparto', role: 'ADMIN' },
  { key: 'analyst', email: 'analista.demo@finturu.com', first: 'Iván', last: 'Instruye', role: 'ANALYST' },
  { key: 'supervisor', email: 'supervisor.demo@finturu.com', first: 'Sara', last: 'Firma', role: 'SUPERVISOR' },
];

function step(n: string, detail = ''): void {
  console.log(`\n${n}${detail ? '  ' + detail : ''}`);
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = (parsed as { error?: { code?: string; message?: string } })?.error;
    throw new Error(`${method} ${path} -> ${res.status} ${code?.code ?? ''} ${code?.message ?? text}`);
  }
  return parsed as T;
}

/** Login de dos pasos: credenciales -> reto MFA -> sesión. */
async function login(person: Person): Promise<string> {
  const begun = await call<{ status: string; challengeToken?: string; enrollmentToken?: string }>(
    'POST',
    '/auth/users/login',
    { organizationSlug: SLUG, email: person.email, password: PASSWORD },
  );
  if (begun.challengeToken === undefined) {
    // Solo pasa si el usuario se sembro sin MFA: el login pediria enrolamiento
    // y este script no lo cubre.
    throw new Error(`${person.email}: se esperaba reto MFA y llego ${begun.status}`);
  }
  const minted = await call<{ accessToken: string }>('POST', '/auth/users/mfa', {
    challengeToken: begun.challengeToken,
    totp: authenticator.generate(person.secret!),
  });
  return minted.accessToken;
}

async function main(): Promise<void> {
  const tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) throw new Error('Falta TOKEN_SECRET.');
  const cipher = new AesGcmSecretCipher(tokenSecret, Number(process.env.TOKEN_KEY_VERSION ?? 1));

  const client = new MongoClient(process.env.MONGO_URI!);
  await client.connect();
  const db = client.db(process.env.MONGO_DB_NAME ?? 'anti_fraud_department');

  try {
    /* ---------------------------------------------------------------- */
    step('1. Identidad', '(directa en Mongo: crearla por API exige OTP)');

    // Idempotente: una segunda pasada rehace su propio escenario y no toca
    // ningun otro inquilino.
    const previous = await db.collection('organizations').findOne({ slug: SLUG });
    if (previous) {
      const prevId = previous._id;
      await db.collection('users').deleteMany({ organization_id: prevId });
      await db.collection('cases').deleteMany({ organization_id: prevId });
      await db.collection('organizations').deleteOne({ _id: prevId });
      console.log('   (escenario anterior retirado)');
    }

    const orgId = new ObjectId();
    await db.collection('organizations').insertOne({
      _id: orgId,
      name: 'Demostración',
      slug: SLUG,
      domain: null,
      status: 'ACTIVE',
      configuration: {},
      email: null,
      password_hash: null,
      login_attempts: 0,
      blocked_until: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });
    console.log(`   organización ${orgId} (slug: ${SLUG})`);

    const passwordHash = await hash(PASSWORD, 12);
    for (const p of PEOPLE) {
      p.secret = authenticator.generateSecret();
      const id = new ObjectId();
      p.id = id.toString();
      await db.collection('users').insertOne({
        _id: id,
        organization_id: orgId,
        email: p.email,
        password_hash: passwordHash,
        first_name: p.first,
        middle_name: null,
        last_name: p.last,
        avatar_url: null,
        status: 'ACTIVE',
        is_platform_admin: false,
        role_id: p.role,
        reset_token: null,
        mfa: { secret: cipher.encrypt(p.secret), enabled: true, recovery_codes: [] },
        login_attempts: 0,
        blocked_until: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`   ${p.role.padEnd(11)} ${p.email}`);
    }

    /* ---------------------------------------------------------------- */
    step('2. Sesiones', '(login real, con MFA)');
    for (const p of PEOPLE) {
      p.token = await login(p);
      console.log(`   ${p.role.padEnd(11)} sesión OK`);
    }
    const admin = PEOPLE[0]!;
    const analyst = PEOPLE[1]!;
    const supervisor = PEOPLE[2]!;

    /* ---------------------------------------------------------------- */
    step('3. Configuración antifraude', '(de aquí sale el plazo de SLA)');
    await call(
      'PUT',
      '/organization-fraud-config',
      {
        slaLowMinutes: 4320,
        slaMediumMinutes: 1440,
        slaHighMinutes: 480,
        slaCriticalMinutes: 120,
        riskThresholdLow: 25,
        riskThresholdMedium: 50,
        riskThresholdHigh: 75,
        riskThresholdCritical: 90,
      },
      supervisor.token,
    );
    console.log('   ✓ umbrales y plazos definidos');

    /* ---------------------------------------------------------------- */
    step('4. Abrir expediente', '(el ADMIN puede: abrir es admisión)');
    const kase = await call<{ id: string; status: string; assignedTo: unknown }>(
      'POST',
      '/cases',
      {
        customerId: 'demo-1887',
        customerEmail: 'sospechoso@example.com',
        bridgeWallet: '0xDEMOWALLET0001',
        riskScore: 82,
        priority: 'HIGH',
      },
      admin.token,
    );
    console.log(`   caso ${kase.id}  estado=${kase.status}  asignado=${kase.assignedTo ?? 'nadie'}`);

    /* ---------------------------------------------------------------- */
    step('5. La puerta de asignación', '(debe RECHAZAR: nadie responde por el caso)');
    try {
      await call('POST', `/cases/${kase.id}/start-review`, {}, analyst.token);
      console.log('   ✗ FALLO: dejó pasar a revisión un caso sin dueño');
    } catch (e) {
      console.log(`   ✓ ${(e as Error).message.split('->')[1]?.trim()}`);
    }

    /* ---------------------------------------------------------------- */
    step('6. Reparto', '(solo el ADMIN)');
    try {
      await call('POST', `/cases/${kase.id}/reassign`,
        { assignedToType: 'USER', assignedToId: analyst.id }, supervisor.token);
      console.log('   ✗ FALLO: el supervisor pudo repartir');
    } catch (e) {
      console.log(`   ✓ supervisor rechazado: ${(e as Error).message.split('->')[1]?.trim()}`);
    }
    await call('POST', `/cases/${kase.id}/reassign`,
      { assignedToType: 'USER', assignedToId: analyst.id }, admin.token);
    console.log(`   ✓ ADMIN lo asignó al analista`);

    /* ---------------------------------------------------------------- */
    step('7. Instrucción', '(ya con dueño)');
    await call('POST', `/cases/${kase.id}/start-review`, {}, analyst.token);
    console.log('   ✓ pasó a revisión');
    await call('POST', `/cases/${kase.id}/notes`,
      { body: 'Patrón de transferencias en ráfaga hacia la misma wallet.' }, analyst.token);
    console.log('   ✓ nota añadida');

    /* ---------------------------------------------------------------- */
    step('8. Dictamen y medida');
    const decision = await call<{ decision: { id: string }; enforcementAction: { id: string } | null }>(
      'POST',
      `/cases/${kase.id}/decisions`,
      {
        decision: 'FRAUD_CONFIRMED',
        confidence: 88,
        comment: 'Red de mulas confirmada.',
        actionType: 'BLOCK',
        targetType: 'WALLET',
        targetId: '0xDEMOWALLET0001',
      },
      analyst.token,
    );
    console.log(`   ✓ dictamen ${decision.decision.id}`);
    console.log(`   ✓ medida ${decision.enforcementAction?.id} en PENDING + solicitud de firma`);

    /* ---------------------------------------------------------------- */
    step('9. Aprobar exige rol de supervisor');
    const actionId = decision.enforcementAction!.id;
    try {
      await call('POST', `/enforcement-actions/${actionId}/approve`, {}, analyst.token);
      console.log('   ✗ FALLO: el analista pudo aprobar');
    } catch (e) {
      console.log(`   ✓ ${(e as Error).message.split('->')[1]?.trim()}`);
    }
    await call('POST', `/enforcement-actions/${actionId}/approve`, {}, supervisor.token);
    console.log('   ✓ la supervisora la aprobó — pero NO está aplicada todavía');

    /* ---------------------------------------------------------------- */
    /*
     * Los cuatro ojos son OTRA cosa que el rol, y el paso anterior no los
     * prueba: al analista lo paró la lista de roles, no la separación de
     * personas. La prueba de verdad es que alguien CON el rol correcto no
     * pueda firmar lo que pidió él mismo.
     */
    step('10. Cuatro ojos', '(quien la pide no la firma, aunque tenga el rol)');
    const own = await call<{ enforcementAction: { id: string } }>(
      'POST',
      `/cases/${kase.id}/enforcement-actions`,
      {
        analystDecisionId: decision.decision.id,
        actionType: 'SUSPEND',
        targetType: 'CUSTOMER',
        targetId: 'demo-1887',
      },
      supervisor.token,
    );
    console.log('   la supervisora pide una segunda medida');
    try {
      await call('POST', `/enforcement-actions/${own.enforcementAction.id}/approve`, {}, supervisor.token);
      console.log('   ✗ FALLO: firmó su propia solicitud');
    } catch (e) {
      console.log(`   ✓ ${(e as Error).message.split('->')[1]?.trim()}`);
    }

    /* ---------------------------------------------------------------- */
    step('LISTO');
    console.log(`   Entrá en el panel con:`);
    for (const p of PEOPLE) {
      console.log(`     ${p.role.padEnd(11)} ${p.email}  /  ${PASSWORD}`);
      console.log(`     ${''.padEnd(11)} TOTP secret: ${p.secret}`);
    }
    console.log(`\n   Organización (slug): ${SLUG}`);
    console.log(`   Caso: ${kase.id}`);
  } finally {
    await client.close();
  }
}

void main().catch((e: unknown) => {
  console.error('\n', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
