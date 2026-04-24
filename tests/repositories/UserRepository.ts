import { CustomQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { UserEntity } from '../entities/UserEntity';

export const UserRepository = dataSource.getRepository(UserEntity).extend({
  qb(alias: string = 'users') {
    return new CustomQueryBuilder(this, alias);
  },
});
