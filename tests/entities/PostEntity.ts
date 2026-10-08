import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserEntity } from './UserEntity';

@Entity('posts')
export class PostEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished!: boolean;

  @ManyToOne(() => UserEntity, (user) => user.posts, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;
}
