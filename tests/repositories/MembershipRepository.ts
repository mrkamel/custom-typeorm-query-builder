import { CustomQueryBuilder } from '../../src/CustomQueryBuilder';
import { dataSource } from '../dataSource';
import { MembershipEntity } from '../entities/MembershipEntity';

export const MembershipRepository = dataSource.getRepository(MembershipEntity).extend({
  qb(alias: string = 'memberships') {
    return new CustomQueryBuilder(this, alias);
  },
});
