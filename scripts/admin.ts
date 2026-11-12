import 'dotenv/config';
import { createAppUser, getAuth } from '../server/auth.js';
import { closeDb, getDb } from '../server/db.js';
import { audit } from '../server/service.js';
import type { User } from '../shared/types.js';

class AdminInputError extends Error {}
const operator: User = {
  id: 'system:admin-cli', name: 'Operação do banco', username: 'admin-cli', role: 'dp', active: true,
};

async function main() {
  const [operation, ...extra] = process.argv.slice(2);
  const username = process.env.DESSINE_ADMIN_USERNAME?.trim().toLowerCase();
  const name = process.env.DESSINE_ADMIN_NAME?.trim();
  const password = process.env.DESSINE_ADMIN_PASSWORD;
  delete process.env.DESSINE_ADMIN_PASSWORD;

  if (extra.length || (operation !== 'bootstrap' && operation !== 'recover')) {
    throw new AdminInputError('Escolha bootstrap ou recover.');
  }
  if (!process.env.DATABASE_URL) throw new AdminInputError('Configure DATABASE_URL para o PostgreSQL de destino.');
  if (!username || !/^[a-z0-9_.]{2,50}$/.test(username)) throw new AdminInputError('Informe DESSINE_ADMIN_USERNAME válido.');
  if (!password || password.length < 12 || password.length > 128) {
    throw new AdminInputError('Informe DESSINE_ADMIN_PASSWORD com 12 a 128 caracteres.');
  }
  if (operation === 'bootstrap' && (!name || name.length < 2 || name.length > 100)) {
    throw new AdminInputError('Informe DESSINE_ADMIN_NAME com 2 a 100 caracteres.');
  }

  const db = await getDb();
  const authContext = await (await getAuth()).$context;
  const passwordHash = operation === 'recover' ? await authContext.password.hash(password) : undefined;
  await db.transaction(async (tx) => {
    const settings = await tx.query('SELECT id FROM settings WHERE id=1 FOR UPDATE');
    if (!settings.length) throw new AdminInputError('Execute db:migrate antes de configurar o acesso.');

    if (operation === 'bootstrap' && name) {
      const dp = await tx.query(`SELECT id FROM "user" WHERE "appRole"='dp' AND banned IS NOT TRUE LIMIT 1`);
      if (dp.length) return;
      const user = await createAppUser({ username, name, password, role: 'dp' }, tx);
      await audit(tx, operator, 'user.bootstrap', 'user', user.id, 'Conta de DP inicial criada pelo procedimento de operação.');
      return;
    }

    const [user] = await tx.query<User>(
      `SELECT id,name,username,"appRole" AS role,true AS active FROM "user"
       WHERE username=$1 AND "appRole"='dp' AND banned IS NOT TRUE FOR UPDATE`, [username],
    );
    if (!user) throw new AdminInputError('A recuperação exige uma conta DP ativa.');
    const credentials = await tx.query(
      `UPDATE account SET password=$1,"updatedAt"=now()
       WHERE "userId"=$2 AND "providerId"='credential' RETURNING id`, [passwordHash, user.id],
    );
    if (credentials.length !== 1) throw new AdminInputError('A conta DP precisa de uma única credencial para recuperação.');
    await tx.query('DELETE FROM session WHERE "userId"=$1', [user.id]);
    await audit(tx, operator, 'user.recovery', 'user', user.id, 'Senha recuperada e sessões revogadas pelo procedimento de operação.');
  });
}

try {
  await main();
  console.log('Procedimento de acesso concluído.');
} catch (error) {
  // Underlying database errors can include identifiers and must stay out of operator logs.
  if (error instanceof AdminInputError) {
    console.error('Procedimento de acesso falhou:', error.message);
  } else {
    console.error('Procedimento de acesso falhou. Confira conexão, esquema e entradas.');
  }
  process.exitCode = 1;
} finally {
  await closeDb();
}
