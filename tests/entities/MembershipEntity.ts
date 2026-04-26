import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('memberships')
export class MembershipEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  tenant_id!: string;

  @PrimaryColumn({ type: 'varchar', length: 36 })
  user_id!: string;

  @Column({ type: 'text' })
  role!: string;
}
