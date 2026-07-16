import { CustomQueryBuilder, defineQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { UserEntity } from '../entities/UserEntity';

const createUserQueryBuilder = defineQueryBuilder(() => UserRepository, {
  named(name: string) {
    return this.where({ name });
  },
  adults() {
    return this.where('users.age >= :min', { min: 18 });
  },
  withProfile() {
    return this.joinsAndSelects(['profile']);
  },
  hasProfile() {
    return this.joins(['profile']);
  },
});

export const UserRepository = dataSource.getRepository(UserEntity).extend({
  qb(alias: string = 'users') {
    return new CustomQueryBuilder(this, alias);
  },
  cqb(alias: string = 'users') {
    return createUserQueryBuilder(this, alias);
  },
});
