import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from './UserEntity';
import type { Relation } from '../../src';

@Entity('profiles')
export class ProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  bio!: string;

  @OneToOne(() => UserEntity, (user) => user.profile, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<UserEntity>;

  @Column({ type: 'uuid' })
  user_id!: string;
}
