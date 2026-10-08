import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('memberships')
export class MembershipEntity {
  @PrimaryColumn({ name: 'tenant_id', type: 'varchar', length: 36 })
  tenantId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'text' })
  role!: string;
}
