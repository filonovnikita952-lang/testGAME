import { db } from '../db/database';
import { ensureSchema } from '../db/init';

ensureSchema()
  .then(() => {
    console.log('Database initialized successfully.');
    db.close();
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    db.close();
    process.exit(1);
  });
