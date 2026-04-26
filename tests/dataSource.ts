import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { UserEntity } from './entities/UserEntity';
import { ProfileEntity } from './entities/ProfileEntity';
import { PostEntity } from './entities/PostEntity';
import { CodeEntity } from './entities/CodeEntity';
import { MembershipEntity } from './entities/MembershipEntity';

const entities = [UserEntity, ProfileEntity, PostEntity, CodeEntity, MembershipEntity];

const driver = process.env.DB_DRIVER ?? 'postgres';

function buildOptions(): DataSourceOptions {
  if (driver === 'sqlite') {
    return {
      type: 'better-sqlite3',
      database: ':memory:',
      entities,
      synchronize: true,
      dropSchema: true,
    };
  }

  if (driver === 'mysql') {
    return {
      type: 'mysql',
      host: process.env.MYSQL_HOST ?? 'localhost',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      username: process.env.MYSQL_USER ?? 'test',
      password: process.env.MYSQL_PASSWORD ?? 'test',
      database: process.env.MYSQL_DATABASE ?? 'test',
      entities,
      synchronize: true,
      dropSchema: true,
    };
  }

  return {
    type: 'postgres',
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5544),
    username: process.env.PGUSER ?? 'test',
    password: process.env.PGPASSWORD ?? 'test',
    database: process.env.PGDATABASE ?? 'test',
    entities,
    synchronize: true,
    dropSchema: true,
  };
}

export const dataSource = new DataSource(buildOptions());
