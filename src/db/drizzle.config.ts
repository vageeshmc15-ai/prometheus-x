import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlHost = process.env.SQL_HOST;
const databaseUrl = process.env.DATABASE_URL;

let dbCredentials:
  | { url: string }
  | { host: string; user: string; password: string; database: string; ssl: boolean };

if (sqlHost) {
  const sqlDbName = process.env.SQL_DB_NAME;
  const user = process.env.SQL_ADMIN_USER;
  const password = process.env.SQL_ADMIN_PASSWORD;

  if (!sqlDbName) {
    throw new Error('SQL_DB_NAME must be set in environment variables.');
  }
  if (!user) {
    throw new Error('SQL_ADMIN_USER must be set in environment variables.');
  }
  if (!password) {
    throw new Error('SQL_ADMIN_PASSWORD must be set in environment variables.');
  }

  dbCredentials = {
    host: sqlHost,
    user,
    password,
    database: sqlDbName,
    ssl: false,
  };
} else if (databaseUrl) {
  dbCredentials = { url: databaseUrl };
} else {
  throw new Error('Either SQL_HOST or DATABASE_URL must be set in environment variables.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials,
  verbose: true,
});
