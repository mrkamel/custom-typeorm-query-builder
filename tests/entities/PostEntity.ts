import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from './UserEntity';

@Entity('posts')
export class PostEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'boolean', default: false })
  published!: boolean;

  @ManyToOne(() => UserEntity, (user) => user.posts, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @Column({ type: 'uuid' })
  user_id!: string;
}
