# Custom TypeORM Query Builder

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

## Setting up a repository

Add a `qb()` helper to each repository so callers don't need to construct the builder themselves:

```ts
import { CustomQueryBuilder } from 'custom-typeorm-query-builder';
import { dataSource } from './dataSource';
import { UserEntity } from './entities/UserEntity';

export const UserRepository = dataSource.getRepository(UserEntity).extend({
  qb(alias: string = 'users') {
    return new CustomQueryBuilder(this, alias);
  },
});
```

## Examples

### Basic equality and `IS NULL`

```ts
await UserRepository.qb().where({ name: 'alice' }).getOne();

await UserRepository.qb().where({ age: null }).getMany();
await UserRepository.qb().whereNot({ age: null }).getMany();
```

Object conditions auto-`AND` and emit `IS NULL` / `IS NOT NULL` for `null` values.

### Mixing raw SQL with object conditions

Each call wraps its raw fragment in `(...)` so precedence is preserved when combined with later `where`s:

```ts
const adultsNamedAliceOrBob = await UserRepository.qb()
  .where('users.name = :a OR users.name = :b', { a: 'alice', b: 'bob' })
  .where({ age: 30 })
  .getMany();
// SQL: WHERE (users.name = $1 OR users.name = $2) AND ("users"."age" = $3)
```

### Reusing a parameter name across chained calls

The same `:value` placeholder is rewritten internally — no collision:

```ts
await UserRepository.qb()
  .where('users.name = :value', { value: 'alice' })
  .where('users.age = :value', { value: 30 })
  .getMany();
```

### Joins

```ts
// Hydrate the relation
await UserRepository.qb()
  .leftJoinAndSelect<['profile']>('users.profile', 'profile')
  .where({ id })
  .getOne();

// Filter by relation without hydrating it
await UserRepository.qb()
  .leftJoin<['profile']>('users.profile', 'profile')
  .where('profile.bio IS NOT NULL')
  .getMany();

// Inner join — only rows with the relation
await UserRepository.qb()
  .innerJoinAndSelect<['profile']>('users.profile', 'profile')
  .getMany();

// Nested relations: chain dotted paths
await ApprovalRequestRepository.qb()
  .leftJoinAndSelect<['instruction']>('approval_requests.instruction', 'instruction')
  .leftJoinAndSelect<['instruction', 'batch']>('instruction.batch', 'batch')
  .leftJoinAndSelect<['instruction', 'batch', 'tenant']>('batch.tenant', 'tenant')
  .getMany();
```

### Counting a relation onto a property

```ts
const user = await UserRepository.qb()
  .loadRelationCountAndMap<'postCount', ['posts']>('users.postCount', 'users.posts')
  .where({ id })
  .getOne();

user?.postCount; // typed as number
```

### Sorting, paging, grouping

```ts
await UserRepository.qb().orderBy({ name: 'ASC' }).getMany();
await UserRepository.qb().orderBy('users.age', 'DESC').getMany();

await UserRepository.qb()
  .orderBy({ name: 'ASC' })
  .skip(20)
  .take(10)
  .getMany();

const [rows, total] = await UserRepository.qb().take(10).getManyAndCount();

await UserRepository.qb()
  .select(['users.name AS name', 'COUNT(*)::int AS count'])
  .groupBy('users.name')
  .getRawMany();
```

### Projection with `select`

After `select(...)` the builder is "projected": `getOne` / `getMany` / `getOneOrFail` are removed at the type level (and throw at runtime) because the resulting rows would be missing entity fields. Use `getRawOne` / `getRawMany` instead:

```ts
const projected = UserRepository.qb().select(['users.name', 'users.age']);

await projected.getRawMany(); // ✓
await projected.getOne();     // ✗ type error + runtime error
```

### Updates

```ts
// Plain object
await UserRepository.qb().where({ id }).update({ status: 'active' });

// Raw SQL expression with safe parameter rewriting
await UserRepository.qb()
  .where({ id })
  .update({ age: () => '"age" + :inc' }, { inc: 1 });
```

### Counting and existence

```ts
await UserRepository.qb().where('users.age >= :min', { min: 18 }).getCount();
await UserRepository.qb().where({ email }).getExists();
```

### Locking

```ts
await UserRepository.qb()
  .where({ id })
  .setLock('pessimistic_write')
  .getOne();
```

### Immutability

Every chained call returns a fresh builder, so a base query can be safely reused as a starting point:

```ts
const activeUsers = UserRepository.qb().where({ status: 'active' });

const recentlyCreated = await activeUsers.orderBy({ created_at: 'DESC' }).take(10).getMany();
const total = await activeUsers.getCount();
```

## Peer dependencies

- `typeorm >= 0.3.0`
