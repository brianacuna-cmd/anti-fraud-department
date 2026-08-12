# Guía de Migración: UUID → ObjectId Nativo de MongoDB

Esta guía muestra el **ANTES** y **DESPUÉS** de cada archivo que requiere modificación para migrar de UUID (crypto.randomUUID()) a ObjectId nativo de MongoDB.

---

## 📌 Notas Importantes

- **NO se han modificado archivos** - Esta es solo una guía de referencia
- Los casos especiales (Roles, Challenges) requieren decisión arquitectónica
- Si hay datos en producción, se requiere script de migración complejo

---

## 1. VALUE OBJECTS (9 archivos)

### 1.1 OrganizationId.ts (identity-access)

**📍 Archivo:** `/workspace/src/modules/identity-access/domain/model/value-objects/OrganizationId.ts`

**ANTES:**
```typescript
import { randomUUID } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type OrganizationId = Brand<string, 'OrganizationId'>;

export function createOrganizationId(value: string): OrganizationId {
  if (value.trim().length === 0) {
    throw invariantViolation('OrganizationId must be a non-empty string', { value });
  }
  return brand<string, 'OrganizationId'>(value);
}

export function generateOrganizationId(): OrganizationId {
  return brand<string, 'OrganizationId'>(randomUUID());
}
```

**DESPUÉS:**
```typescript
import { ObjectId } from 'mongodb';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export type OrganizationId = Brand<ObjectId, 'OrganizationId'>;

export function createOrganizationId(value: string): OrganizationId {
  if (!ObjectId.isValid(value)) {
    throw invariantViolation('OrganizationId must be a valid ObjectId', { value });
  }
  return brand<ObjectId, 'OrganizationId'>(new ObjectId(value));
}

export function generateOrganizationId(): OrganizationId {
  return brand<ObjectId, 'OrganizationId'>(new ObjectId());
}
```

---

### 1.2 UserId.ts (identity-access)

**📍 Archivo:** `/workspace/src/modules/identity-access/domain/model/value-objects/UserId.ts`

**ANTES:**
```typescript
import { randomUUID } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';

export type UserId = Brand<string, 'UserId'>;

export function createUserId(value: string): UserId {
  if (value.trim().length === 0) {
    throw invariantViolation('UserId must be a non-empty string', { value });
  }
  return brand<string, 'UserId'>(value);
}

export function generateUserId(): UserId {
  return brand<string, 'UserId'>(randomUUID());
}
```

**DESPUÉS:**
```typescript
import { ObjectId } from 'mongodb';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';

export type UserId = Brand<ObjectId, 'UserId'>;

export function createUserId(value: string): UserId {
  if (!ObjectId.isValid(value)) {
    throw invariantViolation('UserId must be a valid ObjectId', { value });
  }
  return brand<ObjectId, 'UserId'>(new ObjectId(value));
}

export function generateUserId(): UserId {
  return brand<ObjectId, 'UserId'>(new ObjectId());
}
```

---

### 1.3 SessionId.ts, AuditLogId.ts, AdminOrganizationId.ts, AdminKeyId.ts, FamilyId.ts

**Patrón similar para todos:**

**ANTES:**
```typescript
import { randomUUID } from 'node:crypto';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';

export type XId = Brand<string, 'XId'>;

export function createXId(value: string): XId {
  if (value.trim().length === 0) {
    throw invariantViolation('XId must be a non-empty string', { value });
  }
  return brand<string, 'XId'>(value);
}

export function generateXId(): XId {
  return brand<string, 'XId'>(randomUUID());
}
```

**DESPUÉS:**
```typescript
import { ObjectId } from 'mongodb';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';

export type XId = Brand<ObjectId, 'XId'>;

export function createXId(value: string): XId {
  if (!ObjectId.isValid(value)) {
    throw invariantViolation('XId must be a valid ObjectId', { value });
  }
  return brand<ObjectId, 'XId'>(new ObjectId(value));
}

export function generateXId(): XId {
  return brand<ObjectId, 'XId'>(new ObjectId());
}
```

---

### 1.4 OrganizationId.ts y UserId.ts (notifications)

**📍 Archivos:** 
- `/workspace/src/modules/notifications/domain/model/value-objects/OrganizationId.ts`
- `/workspace/src/modules/notifications/domain/model/value-objects/UserId.ts`

**ANTES:**
```typescript
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';

export type XId = Brand<string, 'XId'>;

export function createXId(value: string): XId {
  if (value.trim().length === 0) {
    throw invariantViolation('XId must be a non-empty string', { value });
  }
  return brand<string, 'XId'>(value);
}
```

**DESPUÉS:**
```typescript
import { ObjectId } from 'mongodb';
import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';

export type XId = Brand<ObjectId, 'XId'>;

export function createXId(value: string): XId {
  if (!ObjectId.isValid(value)) {
    throw invariantViolation('XId must be a valid ObjectId', { value });
  }
  return brand<ObjectId, 'XId'>(new ObjectId(value));
}
```

---

## 2. DOCUMENTOS MONGODB

### 2.1 OrganizationDocument.ts

**📍 Archivo:** `/workspace/src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/OrganizationDocument.ts`

**ANTES:**
```typescript
export interface OrganizationDocument {
  readonly _id: string;
  readonly Name: string;
  readonly Slug: string;
  // ... resto de campos
}
```

**DESPUÉS:**
```typescript
import type { ObjectId } from 'mongodb';

export interface OrganizationDocument {
  readonly _id: ObjectId;
  readonly Name: string;
  readonly Slug: string;
  // ... resto de campos
}
```

---

### 2.2 UserDocument.ts

**📍 Archivo:** `/workspace/src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/UserDocument.ts`

**ANTES:**
```typescript
export interface UserDocument {
  readonly _id: string;
  readonly OrganizationId: string;
  readonly RoleId: string;
  // ... resto de campos
}
```

**DESPUÉS:**
```typescript
import type { ObjectId } from 'mongodb';

export interface UserDocument {
  readonly _id: ObjectId;
  readonly OrganizationId: ObjectId;
  readonly RoleId: string;  // ⚠️ RoleId permanece como string (caso especial)
  // ... resto de campos
}
```

---

### 2.3 SessionDocument.ts

**📍 Archivo:** `/workspace/src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/SessionDocument.ts`

**ANTES:**
```typescript
export interface SessionDocument {
  readonly _id: string;
  readonly UserId: string | null;
  readonly OrganizationId: string | null;
  readonly FamilyId: string;
  readonly RotatedFromSessionId: string | null;
  // ... resto de campos
}
```

**DESPUÉS:**
```typescript
import type { ObjectId } from 'mongodb';

export interface SessionDocument {
  readonly _id: ObjectId;
  readonly UserId: ObjectId | null;
  readonly OrganizationId: ObjectId | null;
  readonly FamilyId: ObjectId;
  readonly RotatedFromSessionId: ObjectId | null;
  // ... resto de campos
}
```

---

### 2.4 AdminOrganizationDocument.ts

**📍 Archivo:** `/workspace/src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/AdminOrganizationDocument.ts`

**ANTES:**
```typescript
export interface AdminKeyDocument {
  readonly keyId: string;
  // ... resto
}

export interface AdminOrganizationDocument {
  readonly _id: string;
  readonly keys: readonly AdminKeyDocument[];
  // ... resto
}
```

**DESPUÉS:**
```typescript
import type { ObjectId } from 'mongodb';

export interface AdminKeyDocument {
  readonly keyId: ObjectId;
  // ... resto
}

export interface AdminOrganizationDocument {
  readonly _id: ObjectId;
  readonly keys: readonly AdminKeyDocument[];
  // ... resto
}
```

---

### 2.5 AuditLogDocument.ts

**📍 Archivo:** `/workspace/src/modules/audit/infrastructure/adapters/outbound/mongo/documents/AuditLogDocument.ts`

**ANTES:**
```typescript
export interface AuditLogDocument {
  readonly _id: string;
  readonly OrganizationId: string | null;
  readonly ActorId: string | null;
  readonly ResourceId: string | null;
  // ... resto
}
```

**DESPUÉS:**
```typescript
import type { ObjectId } from 'mongodb';

export interface AuditLogDocument {
  readonly _id: ObjectId;
  readonly OrganizationId: ObjectId | null;
  readonly ActorId: ObjectId | null;
  readonly ResourceId: ObjectId | null;
  // ... resto
}
```

---

## 3. CASOS ESPECIALES - NO MIGRAR

### 3.1 RolDocument.ts
**📍 Archivo:** `/workspace/src/modules/identity-access/infrastructure/adapters/outbound/mongo/documents/RolDocument.ts`

**⚠️ MANTENER COMO STRING** - Los roles tienen IDs semánticos fijos: 'ADMIN', 'SUPERVISOR', 'ANALYST', 'AUDITOR'

```typescript
export interface RolDocument {
  readonly _id: string;  // 'ADMIN', 'SUPERVISOR', etc.
  readonly RoleName: string;
  // ... resto
}
```

### 3.2 AdminChallengeDocument.ts y MfaChallengeDocument.ts
**⚠️ MANTENER COMO STRING** - Usan tokens criptográficos como ID para lookup atómico eficiente

---

Continúa en la siguiente sección...
