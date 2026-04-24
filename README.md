# custom-typeorm-query-builder

A type-safe wrapper around TypeORM's `SelectQueryBuilder` with:

- Immutable chaining (every method returns a clone)
- Automatic parameter renaming to avoid collisions
- Stricter relation typing via dotted-path inference (`leftJoinAndSelect`, `innerJoin`, etc.)
- A projection-aware `select` that prevents `getOne`/`getMany` from returning entities with missing fields
- Powerful `where()` / `whereNot()` accepting object parameters (with proper `IS NULL` / `IS NOT NULL` handling)
- Named parameter fix: parameters are rewritten and namespaced so user-supplied names never collide across chained calls
- Fixed `where` using braces: every condition is wrapped in `(...)` so combining with `OR`/`AND` produces correct precedence
- Powerful `update()` accepting object parameter

## Installation

```bash
npm install custom-typeorm-query-builder typeorm
```

## Usage

```ts
import { CustomQueryBuilder } from 'custom-typeorm-query-builder';

const qb = new CustomQueryBuilder(repository, 'users');

const user = await qb
  .leftJoinAndSelect<['profile']>('users.profile', 'profile')
  .where({ id: '123' })
  .getOne();
```

## Peer dependencies

- `typeorm@^0.3.0`
