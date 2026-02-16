import { env } from './config/env';
import { ensureSchema } from './db/init';
import { buildApp } from './app';

async function start() {
  await ensureSchema();

  const app = buildApp();
  app.listen(env.PORT, () => {
    console.log(`OTP service listening on port ${env.PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
