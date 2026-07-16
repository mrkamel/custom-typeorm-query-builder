import { CustomQueryBuilder, defineQueryBuilder, defineSharedQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { UserEntity } from '../entities/UserEntity';

const sharedQueryBuilder = defineSharedQueryBuilder({
  paginate({ page, perPage }: { page: number, perPage: number }) {
    return this.skip((page - 1) * perPage).take(perPage);
  },
});

const createUserQueryBuilder = defineQueryBuilder(() => UserRepository, {
  ...sharedQueryBuilder,
  named(name: string) {
    return this.where({ name });
  },
  adults() {
    return this.where('users.age >= :min', { min: 18 });
  },
  withProfile() {
    return this.joinsAndSelects(['profile']);
  },
  withPosts() {
    return this.leftJoinsAndSelects(['posts']);
  },
  hasProfile() {
    return this.joins(['profile']);
  },
  orderedByName() {
    return this.orderBy({ name: 'ASC' });
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
