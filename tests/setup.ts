import { afterAll, beforeAll, beforeEach } from 'vitest';
import { dataSource } from './dataSource';

beforeAll(async () => {
  await dataSource.initialize();
});

afterAll(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

beforeEach(async () => {
  for (const entity of dataSource.entityMetadatas) {
    await dataSource.query(`TRUNCATE TABLE "${entity.tableName}" CASCADE`);
  }
});
