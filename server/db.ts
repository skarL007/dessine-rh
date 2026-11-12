import 'dotenv/config';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { Pool, types as pgTypes } from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import * as authSchema from './auth-schema.js';

export type Row = Record<string, any>;
export interface Queryable { query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>; }
export const SCHEMA_VERSION = 3;
export interface Database extends Queryable {
  orm: any;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  mode: 'local' | 'production';
}
let databasePromise: Promise<Database> | undefined;
export function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('NUMERIC_RANGE_EXCEEDED');
  return parsed;
}

async function connect(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 8_000,
      types: { getTypeParser: (oid: number, format?: any) => oid === 1082 ? (value: string) => value : oid === 20 ? parseSafeInteger : pgTypes.getTypeParser(oid, format) },
    });
    pool.on('error', () => console.error('database_pool_error'));
    return {
      orm: drizzlePg(pool, { schema: authSchema }), mode: 'production',
      query: async (sql, params = []) => (await pool.query(sql, params)).rows,
      async transaction(fn) {
        const client = await pool.connect();
        try { await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); const result = await fn({ query: async (sql, params = []) => (await client.query(sql, params)).rows }); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  if (process.env.VERCEL || process.env.APP_ENV !== 'local') throw new Error('DATABASE_CONFIGURATION_REQUIRED');
  const { PGlite } = await import('@electric-sql/pglite');
  const directory = resolve(process.env.PGLITE_DIR || '.data/local');
  await mkdir(directory, { recursive: true });
  const client = new PGlite(directory, { parsers: { 1082: (value: string) => value, 20: parseSafeInteger } });
  await client.waitReady;
  return {
    orm: drizzlePglite(client, { schema: authSchema }), mode: 'local',
    query: async (sql, params = []) => (await client.query(sql, params)).rows as any,
    transaction: (fn) => client.transaction((tx) => fn({ query: async (sql, params = []) => (await tx.query(sql, params)).rows as any })),
    close: () => client.close(),
  };
}

export function getDb(): Promise<Database> { return databasePromise ??= connect().catch(error => { databasePromise = undefined; throw error; }); }
export async function closeDb() { if (databasePromise) { await (await databasePromise).close(); databasePromise = undefined; } }

export const defaultSettings = {
  companyName: 'Dessine', foodDailyCents: 2800, foodPaymentMethod: 'Cartão Caju', salaryPayDay: 5,
  transportPayDay: 5, transportStartDay: 6, absenceClosingDay: 31,
  transportDiscountPercent: 4, holidays: [], version: 1,
};

// Deliberately explicit migration, never executed by an HTTP request.
export const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, "appliedAt" timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS "user" (
    id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false,
    image text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
    username text UNIQUE, "displayUsername" text, role text NOT NULL DEFAULT 'user', banned boolean NOT NULL DEFAULT false,
    "banReason" text, "banExpires" timestamptz, "appRole" text NOT NULL DEFAULT 'diretoria' CHECK ("appRole" IN ('dp','financeiro','diretoria'))
  )`,
  `CREATE TABLE IF NOT EXISTS "session" (
    id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
    "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
    "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, "impersonatedBy" text
  )`,
  `CREATE INDEX IF NOT EXISTS session_user_idx ON "session"("userId")`,
  `CREATE TABLE IF NOT EXISTS account (
    id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz,
    "refreshTokenExpiresAt" timestamptz, scope text, password text,
    "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("providerId", "accountId")
  )`,
  `CREATE INDEX IF NOT EXISTS account_user_idx ON account("userId")`,
  `CREATE TABLE IF NOT EXISTS verification (
    id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier)`,
  `CREATE TABLE IF NOT EXISTS "rateLimit" (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL DEFAULT 0, "lastRequest" bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (id integer PRIMARY KEY CHECK (id=1), data jsonb NOT NULL, version integer NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS employees (
    id text PRIMARY KEY, name text NOT NULL, "jobTitle" text NOT NULL, department text NOT NULL,
    "admissionDate" date NOT NULL, "terminationDate" date,
    "salaryCents" integer NOT NULL CHECK ("salaryCents">=0), "usesTransport" boolean NOT NULL,
    "transportDailyCents" integer NOT NULL CHECK ("transportDailyCents">=0),
    status text NOT NULL CHECK (status IN ('active','inactive')), version integer NOT NULL DEFAULT 1,
    "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
    CHECK ("terminationDate" IS NULL OR "terminationDate">="admissionDate")
  )`,
  `CREATE INDEX IF NOT EXISTS employees_name_idx ON employees(lower(name))`,
  `CREATE INDEX IF NOT EXISTS employees_status_idx ON employees(status)`,
  `CREATE TABLE IF NOT EXISTS absences (
    id text PRIMARY KEY, "employeeId" text NOT NULL REFERENCES employees(id), date date NOT NULL,
    reason text NOT NULL, "discountBenefits" boolean NOT NULL DEFAULT true,
    "createdBy" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "voidedAt" timestamptz, "voidReason" text
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS absence_employee_date_idx ON absences("employeeId",date) WHERE "voidedAt" IS NULL`,
  `CREATE INDEX IF NOT EXISTS absences_date_idx ON absences(date) WHERE "voidedAt" IS NULL`,
  `CREATE TABLE IF NOT EXISTS payrolls (
    id text PRIMARY KEY, month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
    status text NOT NULL CHECK (status IN ('closed','reopened')),
    "closedAt" timestamptz NOT NULL DEFAULT now(), "closedBy" text NOT NULL,
    version integer NOT NULL DEFAULT 1, snapshot jsonb NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payroll_closed_month_idx ON payrolls(month) WHERE status='closed'`,
  `CREATE INDEX IF NOT EXISTS payroll_month_idx ON payrolls(month)`,
  `CREATE TABLE IF NOT EXISTS payments (
    id text PRIMARY KEY, "payrollId" text NOT NULL REFERENCES payrolls(id), month text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('salary','food','transport')), description text NOT NULL,
    "amountCents" bigint NOT NULL CHECK ("amountCents">=0), "dueDate" date NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','void')),
    "paidAt" timestamptz, "paidBy" text, note text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
    UNIQUE ("payrollId",kind)
  )`,
  `CREATE INDEX IF NOT EXISTS payments_month_idx ON payments(month,status)`,
  `CREATE INDEX IF NOT EXISTS payments_due_idx ON payments("dueDate") WHERE status='pending'`,
  `CREATE TABLE IF NOT EXISTS audit (
    id text PRIMARY KEY, "actorName" text NOT NULL, "actorId" text NOT NULL,
    action text NOT NULL, "entityType" text NOT NULL, "entityId" text NOT NULL, summary text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS audit_created_idx ON audit("createdAt" DESC)`,
];

export async function migrate() {
  const db = await getDb();
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(1146244181, 1)');
    for (const statement of migrationStatements) await tx.query(statement);
    const applied = new Set((await tx.query<{ version: number }>('SELECT version FROM schema_migrations')).map(row => row.version));
    if ([...applied].some(version => version > SCHEMA_VERSION)) throw new Error('SCHEMA_VERSION_UNSUPPORTED');
    await tx.query('INSERT INTO settings(id,data,version) VALUES(1,$1::jsonb,1) ON CONFLICT(id) DO NOTHING', [JSON.stringify(defaultSettings)]);
    await tx.query('INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT(version) DO NOTHING');
    if (!applied.has(2)) {
      await tx.query('ALTER TABLE payments ALTER COLUMN "amountCents" TYPE bigint');
      await tx.query('INSERT INTO schema_migrations(version) VALUES(2)');
    }
    if (!applied.has(3)) {
      await tx.query('ALTER TABLE payrolls ADD COLUMN revision integer');
      await tx.query(`WITH ordered AS (
        SELECT id, row_number() OVER (PARTITION BY month ORDER BY (status='closed'), "closedAt", id)::integer AS revision
        FROM payrolls
      )
      UPDATE payrolls SET revision=ordered.revision FROM ordered WHERE payrolls.id=ordered.id`);
      await tx.query('ALTER TABLE payrolls ALTER COLUMN revision SET DEFAULT 1, ALTER COLUMN revision SET NOT NULL');
      await tx.query('CREATE UNIQUE INDEX payroll_month_revision_idx ON payrolls(month, revision)');
      await tx.query('INSERT INTO schema_migrations(version) VALUES(3)');
    }
  });
}
