import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('memberships')
export class MembershipEntity {
  @PrimaryColumn({ type: 'uuid' })
  tenant_id!: string;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'text' })
  role!: string;
}
