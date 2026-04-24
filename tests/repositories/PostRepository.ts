import { CustomQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { PostEntity } from '../entities/PostEntity';

export const PostRepository = dataSource.getRepository(PostEntity).extend({
  qb(alias: string = 'posts') {
    return new CustomQueryBuilder(this, alias);
  },
});
