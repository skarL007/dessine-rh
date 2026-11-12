import { migrate, closeDb } from '../server/db.js';
try { await migrate(); console.log('Schema migration completed.'); }
catch { console.error('Migration failed. Check database connectivity and server configuration.'); process.exitCode = 1; }
finally { await closeDb(); }
