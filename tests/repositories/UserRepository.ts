import { CustomQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { UserEntity } from '../entities/UserEntity';

export const UserRepository = dataSource.getRepository(UserEntity).extend({
  qb(alias: string = 'users') {
    return new CustomQueryBuilder(this, alias);
  },
  named(name: string) {
    return this.qb().where({ name });
  },
  adults() {
    return this.qb().where('age >= :minAge', { minAge: 18 });
  },
  withProfile() {
    return this.qb().leftJoinsAndSelects(['profile']);
  },
  adultsViaHelper() {
    this.qb('unrelated').where({ name: 'ignored' });
    return this.qb().where('age >= :minAge', { minAge: 18 });
  },
});
