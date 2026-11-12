import { pgTable, text, boolean, timestamp, integer, bigint } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('createdAt', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow();
export const user = pgTable('user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false), image: text('image'),
  createdAt: createdAt(), updatedAt: updatedAt(), username: text('username').unique(), displayUsername: text('displayUsername'),
  role: text('role').default('user'), banned: boolean('banned').default(false), banReason: text('banReason'),
  banExpires: timestamp('banExpires', { withTimezone: true }), appRole: text('appRole').notNull().default('diretoria'),
});
export const session = pgTable('session', {
  id: text('id').primaryKey(), expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(), token: text('token').notNull().unique(),
  createdAt: createdAt(), updatedAt: updatedAt(), ipAddress: text('ipAddress'), userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }), impersonatedBy: text('impersonatedBy'),
});
export const account = pgTable('account', {
  id: text('id').primaryKey(), accountId: text('accountId').notNull(), providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }), accessToken: text('accessToken'),
  refreshToken: text('refreshToken'), idToken: text('idToken'), accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }), scope: text('scope'), password: text('password'),
  createdAt: createdAt(), updatedAt: updatedAt(),
});
export const verification = pgTable('verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
});
export const rateLimit = pgTable('rateLimit', {
  id: text('id').primaryKey(), key: text('key').notNull().unique(), count: integer('count').notNull(), lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
});
