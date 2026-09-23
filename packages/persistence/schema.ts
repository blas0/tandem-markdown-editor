import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const receipts = sqliteTable('receipts', {
  id: text('id').primaryKey(),
  request: text('request').notNull(),
  result: text('result').notNull(),
});
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  metadata: text('metadata').notNull(),
  snapshot: text('snapshot').notNull(),
  snapshotRevision: integer('snapshot_revision').notNull().default(0),
  revision: integer('revision').notNull().default(0),
});
export const operations = sqliteTable('operations', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id),
  revision: integer('revision').notNull(),
  edit: text('edit').notNull(),
  origin: text('origin').notNull(),
  createdAt: text('created_at').notNull(),
});
export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
});
export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id),
  data: text('data').notNull(),
});
export const coverage = sqliteTable('coverage', {
  documentId: text('document_id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull(),
});
export const preferences = sqliteTable('preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const events = sqliteTable('events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  documentId: text('document_id'),
  payload: text('payload'),
});
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  path: text('path').notNull(),
});
