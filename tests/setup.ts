import { afterAll, beforeAll, beforeEach } from 'vitest';
import { dataSource } from './dataSource';

beforeAll(async () => {
  await dataSource.initialize();
});

afterAll(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

beforeEach(async () => {
  const escape = (name: string) => dataSource.driver.escape(name);

  for (const entity of dataSource.entityMetadatas) {
    await dataSource.query(`DELETE FROM ${escape(entity.tableName)}`);
  }
});
