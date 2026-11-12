import { betterAuth } from 'better-auth';
import { randomUUID } from 'node:crypto';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { admin, username } from 'better-auth/plugins';
import { getDb, type Database, type Queryable } from './db.js';
import * as schema from './auth-schema.js';
import type { AppRole, User } from '../shared/types.js';
import { usernameSchema, userSchema } from './validation.js';

async function createAuth(db: Database) {
    const secret = process.env.BETTER_AUTH_SECRET;
    const baseURL = process.env.BETTER_AUTH_URL;
    if (!secret || secret.length < 32 || !baseURL) throw new Error('AUTH_CONFIGURATION_REQUIRED');
    if (process.env.VERCEL && !baseURL.startsWith('https://')) throw new Error('HTTPS_REQUIRED');
    return betterAuth({
      appName: 'Dessine RH', secret, baseURL,
      database: drizzleAdapter(db.orm, { provider: 'pg', schema, transaction: true }),
      trustedOrigins: [new URL(baseURL).origin],
      emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: false },
      user: { additionalFields: { appRole: { type: 'string', input: false, defaultValue: 'diretoria' } } },
      session: { expiresIn: 60 * 60 * 8, updateAge: 60 * 30, cookieCache: { enabled: false } },
      rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
        customRules: { '/sign-in/username': { window: 300, max: 8 }, '/change-password': { window: 300, max: 5 } } },
      advanced: {
        useSecureCookies: baseURL.startsWith('https://'),
        defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
        ipAddress: { ipAddressHeaders: ['x-dessine-client-ip'] },
      },
      plugins: [username({ minUsernameLength: 2, maxUsernameLength: 50, usernameValidator: value => usernameSchema.safeParse(value).success }), admin()],
      logger: { disabled: true },
    });
}
const authByDatabase = new WeakMap<Database, ReturnType<typeof createAuth>>();
export async function getAuth() {
  const db = await getDb();
  const existing = authByDatabase.get(db);
  if (existing) return existing;

  const auth = createAuth(db).catch(error => { authByDatabase.delete(db); throw error; });
  authByDatabase.set(db, auth);
  return auth;
}
export function publicUser(value: any): User {
  return { id: value.id, name: value.name, username: value.username || '', role: value.appRole as AppRole, active: !value.banned };
}

// Provision the Better Auth credential in the caller's transaction when an audit event must commit with it.
export async function createAppUser(input: { username: string; name: string; password: string; role: AppRole }, transaction?: Queryable): Promise<User> {
  const data = userSchema.parse(input);
  const { password } = await (await getAuth()).$context;
  const passwordHash = await password.hash(data.password);
  const id = randomUUID();
  const login = data.username.toLowerCase();
  const insert = async (db: Queryable) => {
    await db.query(
      'INSERT INTO "user"(id,name,email,username,"displayUsername",role,"appRole") VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id,data.name,`${login}@accounts.dessine.invalid`,login,data.username,data.role === 'dp' ? 'admin' : 'user',data.role],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,$3,$2,$4)',
      [randomUUID(),id,'credential',passwordHash],
    );
    return { id, name: data.name, username: login, role: data.role, active: true };
  };
  return transaction ? insert(transaction) : (await getDb()).transaction(insert);
}
