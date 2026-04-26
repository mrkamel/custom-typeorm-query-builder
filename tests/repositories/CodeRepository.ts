import { CustomQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { CodeEntity } from '../entities/CodeEntity';

export const CodeRepository = dataSource.getRepository(CodeEntity).extend({
  qb(alias: string = 'codes') {
    return new CustomQueryBuilder(this, alias);
  },
});
