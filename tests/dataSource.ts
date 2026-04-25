import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserEntity } from './entities/UserEntity';
import { ProfileEntity } from './entities/ProfileEntity';
import { PostEntity } from './entities/PostEntity';
import { CodeEntity } from './entities/CodeEntity';

export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5544),
  username: process.env.PGUSER ?? 'test',
  password: process.env.PGPASSWORD ?? 'test',
  database: process.env.PGDATABASE ?? 'test',
  entities: [UserEntity, ProfileEntity, PostEntity, CodeEntity],
  synchronize: true,
  dropSchema: true,
});
