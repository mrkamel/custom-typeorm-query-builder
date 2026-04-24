import { Column, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProfileEntity } from './ProfileEntity';
import { PostEntity } from './PostEntity';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'integer', nullable: true })
  age!: number | null;

  @OneToOne(() => ProfileEntity, (profile) => profile.user)
  profile?: ProfileEntity | null;

  @OneToMany(() => PostEntity, (post) => post.user)
  posts?: PostEntity[];
}
