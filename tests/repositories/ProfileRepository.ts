import { CustomQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { ProfileEntity } from '../entities/ProfileEntity';

export const ProfileRepository = dataSource.getRepository(ProfileEntity).extend({
  qb(alias: string = 'profiles') {
    return new CustomQueryBuilder(this, alias);
  },
});
