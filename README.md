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

### `IN` / `NOT IN` via array values

Pass an array as the value to get `IN` (or `NOT IN` with `whereNot`):

```ts
await UserRepository.qb().where({ id: [1, 2, 3] }).getMany();
// WHERE "users"."id" IN ($1, $2, $3)

await UserRepository.qb().whereNot({ status: ['archived', 'deleted'] }).getMany();
// WHERE "users"."status" NOT IN ($1, $2)
```

Empty arrays are handled the same way ActiveRecord does:

- `where({ id: [] })` → `WHERE 1 = 0` (matches no rows)
- `whereNot({ id: [] })` → `WHERE 1 = 1` (matches all rows)

### Object form value rules

The object form of `where` / `whereNot` distinguishes three column shapes:

1. **Scalar columns** (`string`, `number`, `boolean` and their
   nullable variants) — strict typing. The value must match the column's
   TS type, optionally as an array for `IN`/`NOT IN`.

   ```ts
   await UserRepository.qb().where({ name: 'alice' }).getMany();
   await UserRepository.qb().where({ id: [1, 2, 3] }).getMany();
   ```

2. **Non-scalar non-array columns** (transformer-wrapped types like
   `Decimal` / `UUID` / branded IDs, JSONB-shaped objects, …) — pass any
   scalar (string, number, boolean) and let the database coerce.
   The wrapper instance itself is *not* accepted; pass its serialized
   form. The value comes back hydrated through the column's `from`
   transformer on read.

   ```ts
   // Decimal column: pass a string, Postgres coerces to numeric
   await OrderRepository.qb().where({ total: '99.95' }).getMany();

   // UUID column with a wrapper class: pass the canonical string
   await UserRepository.qb().where({ id: '00000000-0000-…' }).getMany();
   ```

3. **Array-typed columns** (`text[]`, JSONB-of-array, …) — rejected at
   the type level. Equality, `IN`, containment (`@>`), and `= ANY` are
   all valid SQL operations against array columns and we can't guess
   which you mean. Use raw SQL.

   ```ts
   await PostRepository.qb()
     .where('posts.tags @> :tags', { tags: ['featured'] })
     .getMany();
   ```

For anything more exotic (JSONB containment, key extraction, casting,
custom operators) drop to raw SQL — you pick the operator instead of us
guessing:

```ts
await EventRepository.qb()
  .where('events.metadata @> :metadata', { metadata: { source: 'webhook' } })
  .getMany();
```

We deliberately do *not* invoke the column's `to` transformer on values
passed through the object form. A transformer like
`to: state => state.toLowerCase()` would turn
`where({ state: 'New York' })` into a query for `'new york'` — the right
rows for the wrong-looking reason. The case-mismatch returning zero rows
is a more noticeable failure than silent normalization returning
unexpected matches. If you need the transformer applied, call it
yourself or use raw SQL.

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

### Simplified join loading

`leftJoinsAndSelect()` hydrates relations via `LEFT JOIN AND SELECT`. The spec is
either an array of relation names (leaves) or an object whose values are
themselves specs (for nesting). Keys are restricted to actual relation
properties of the entity; scalar columns and unknown keys are rejected at
the type level. The return type is narrowed so loaded relations become
non-nullable.

Aliases are derived from the target entity's table name — so in the
examples below the `profile` relation joins as `profiles`, `posts` as
`posts`, and a nested `user` as `users`.

```ts
// Single or multiple leaves
await UserRepository.qb().leftJoinsAndSelect(['profile']).getMany();
await UserRepository.qb().leftJoinsAndSelect(['profile', 'posts']).getMany();

// Nested — use an object at the level you want to nest, array (or object)
// for the leaves
await PostRepository.qb().leftJoinsAndSelect({ user: ['profile'] }).getMany();
await UserRepository.qb().leftJoinsAndSelect({ posts: { user: ['profile'] } }).getMany();

// The join alias matches the target table name, so you can reference it
// in where clauses:
await UserRepository.qb()
  .leftJoinsAndSelect(['profile'])
  .where('profiles.bio = :bio', { bio: 'hello' })
  .getMany();
```

### Joining without hydrating (`joins` / `leftJoins`)

`joins()` and `leftJoins()` mirror `leftJoinsAndSelect()` — same array/object spec, same table-name
aliases — but do **not** select the joined columns. Use them when you want to filter or
order by a related table without paying to hydrate it.

- `joins(spec)` → `INNER JOIN` (drops rows without a match)
- `leftJoins(spec)` → `LEFT JOIN` (keeps rows without a match)

```ts
// Only return users that have a profile
await UserRepository.qb().joins(['profile']).getMany();

// Keep everyone, but expose the profiles alias for filtering/ordering
await UserRepository.qb()
  .leftJoins(['profile'])
  .where('profiles.bio IS NOT NULL')
  .getMany();

// Nested
await PostRepository.qb().joins({ user: ['profile'] }).getMany();
```

The return type is unchanged — relations are not hydrated, so they remain optional on the entity.

### `joinsAndSelect` — filter and hydrate

`joinsAndSelect()` is the `INNER JOIN + SELECT` counterpart of `leftJoinsAndSelect()`:
it hydrates the relation *and* drops rows without a match. Same spec and
alias rules. Unlike `leftJoinsAndSelect` (which keeps relations nullable to reflect
the LEFT JOIN), the return type marks loaded relations as non-null.

```ts
// Only users that have a profile; `profile` is typed as present
const users = await UserRepository.qb().joinsAndSelect(['profile']).getMany();
users[0].profile.bio; // no optional chaining needed
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

When `sort` is a raw string and you need bound parameters, pass them as the
second argument and embed the direction in the SQL itself. Names are
rewritten the same way as in `where()`, so they can't collide with
parameters used elsewhere in the chain:

```ts
await TermPolicyRepository.qb()
  .orderBy('ts_rank(search_vector, to_tsquery(\'simple\', :q)) DESC', { q: prefixQuery })
  .getMany();

// Same name reused across where + orderBy is safe — both get rewritten:
await UserRepository.qb()
  .where('users.age >= :value', { value: 40 })
  .orderBy('ABS(users.age - :value) ASC', { value: 45 })
  .getMany();
```

`skip` / `take` are the ORM-level pagination knobs — they become `OFFSET` /
`LIMIT` for simple queries, and switch to TypeORM's distinct-alias two-query
strategy when combined with a `*-to-many` join load. `limit(n)` is a raw
`LIMIT` only — no offset, no pagination rewrites. Use it when you want a
hard cap on rows without TypeORM touching the query shape.

### `distinct`

```ts
// SELECT DISTINCT ...
await UserRepository.qb().distinct().getMany();

// Opt back out on a cloned chain
await base.distinct(false).getMany();
```

### Projection with `select`

After `select(...)` the builder is "projected": `getOne` / `getMany` / `getOneOrFail`
are removed at the type level (and throw at runtime) because the resulting rows
would be missing entity fields. Use `getRawOne` / `getRawMany` instead:

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

### Deletes

`delete()` runs `DELETE FROM ... WHERE ...` against the matching rows. It
executes immediately (no `.getMany()` — this is a terminal call) and
returns the TypeORM `DeleteResult`.

```ts
await UserRepository.qb().where({ id }).delete();
await UserRepository.qb().where('users.age < :cutoff', { cutoff: 18 }).delete();
```

### Inspecting the generated SQL

`getSql()` returns the SQL TypeORM would emit for the current chain — handy
for debugging or asserting structure in tests without hitting the database.

```ts
const sql = UserRepository.qb().where({ id }).getSql();
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

### Escape hatch: `getRawQueryBuilder`

When you need something our wrapper doesn't cover (custom CTEs, vendor-specific SQL, driver-level
methods, etc.), drop down to the underlying TypeORM `SelectQueryBuilder`:

```ts
const raw = UserRepository.qb()
  .where({ active: true })
  .getRawQueryBuilder();

raw.addCommonTableExpression(/* ... */).addOrderBy(/* ... */);
const rows = await raw.getMany();
```

The returned builder is a clone, so mutating it never leaks back into the wrapper you called it on.

### Immutability

Every chained call returns a fresh builder, so a base query can be safely reused as a starting point:

```ts
const activeUsers = UserRepository.qb().where({ status: 'active' });

const recentlyCreated = await activeUsers.orderBy({ created_at: 'DESC' }).take(10).getMany();
const total = await activeUsers.getCount();
```

## Peer dependencies

- `typeorm >= 0.3.0`
