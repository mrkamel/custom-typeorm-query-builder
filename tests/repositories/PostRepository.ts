import { CustomQueryBuilder, defineQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { PostEntity } from '../entities/PostEntity';

const createPostQueryBuilder = defineQueryBuilder(() => PostRepository, {
  authoredBy(name: string) {
    return this.joins(['user']).where('user.name = :name', { name });
  },
});

export const PostRepository = dataSource.getRepository(PostEntity).extend({
  qb(alias: string = 'posts') {
    return new CustomQueryBuilder(this, alias);
  },
  cqb(alias: string = 'posts') {
    return createPostQueryBuilder(this, alias);
  },
});
