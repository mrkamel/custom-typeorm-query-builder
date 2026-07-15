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

## Custom query builders

`defineQueryBuilder` attaches reusable, chainable filter methods to a repository's
builder. Each method runs with `this` bound to the builder, so it can call any
built-in (`where`, joins, …) or another custom method, and every method returns a
builder that still carries the custom methods — so custom and built-in calls chain
in any order.

Define the builder factory in the repository's source file and have `qb()` return
it, so callers get the custom methods through the same `qb()` entry point they
already use:

```ts
import { defineQueryBuilder } from 'custom-typeorm-query-builder';
import { dataSource } from './dataSource';
import { UserEntity } from './entities/UserEntity';

export const UserRepository = dataSource.getRepository(UserEntity).extend({
  qb(alias: string = 'users') {
    return createUserQueryBuilder(alias);
  },
});

const createUserQueryBuilder = defineQueryBuilder(UserRepository, {
  named(name: string) {
    return this.where({ name });
  },
  adults() {
    return this.where('users.age >= :min', { min: 18 });
  },
  withProfile() {
    return this.joinsAndSelects(['profile']);
  },
});
```

Now every `UserRepository.qb()` chain has the custom methods available alongside
the built-ins, in any order:

```ts
await UserRepository.qb().adults().named('alice').getMany();
await UserRepository.qb().where({ name: 'alice' }).adults().getMany();
```

Relation narrowing survives a custom join method, so a hydrated relation stays
non-nullable through the rest of the chain:

```ts
const user = await UserRepository.qb().withProfile().getOneOrFail();
user.profile.bio;
```

`defineQueryBuilder` returns a factory that requires the alias to use, so pick the
default in your `qb()` wrapper (as above) and let callers override it per query:

```ts
await UserRepository.qb('u').where('u.age >= :min', { min: 18 }).getMany();
```

Defining the builder in the repository's module (as above) has no import cycle. If
you split it into its own file, that file and the repository import each other —
pass a thunk so the repository resolves lazily and load order stops mattering:

```ts
const createUserQueryBuilder = defineQueryBuilder(() => UserRepository, { /* ... */ });
```

Immutability is preserved — every call, custom or built-in, returns a clone. An
extension whose name collides with a built-in builder method is a compile-time
error. A raw-SQL extension that hardcodes an alias (like `adults` above) is tied to
that alias, so use the default alias with it or write the condition against the
alias you pass.

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

Empty arrays are handled using:

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

### `all()` / `none()`

Convenience builders for code paths that need to express "every row" or "no rows"
explicitly — handy when the filter is built conditionally:

```ts
const builder = filters.length > 0
  ? UserRepository.qb().where({ id: filters })
  : UserRepository.qb().all();

const blocked = isDryRun ? UserRepository.qb().none() : UserRepository.qb().where({ active: true });
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

`leftJoinsAndSelects()` hydrates relations via `LEFT JOIN AND SELECT`. The spec is
either an array of relation names (leaves) or an object whose values are
themselves specs (for nesting). Keys are restricted to actual relation
properties of the entity; scalar columns and unknown keys are rejected at
the type level. The return type is narrowed so loaded relations become
non-nullable.

Aliases are the relation property name — same as what you wrote. So
`['profile']` joins as `profile`, nested `{ posts: ['user'] }` joins as
`posts` and `user`. If two paths in the same query collide on the relation
name (e.g. two relations on the same entity both pointing at `User`, or a
nested name shadowing a top-level one), drop to the single-relation
`leftJoinAndSelect` form and pick an explicit alias for the conflicting
join.

```ts
// Single or multiple leaves
await UserRepository.qb().leftJoinsAndSelects(['profile']).getMany();
await UserRepository.qb().leftJoinsAndSelects(['profile', 'posts']).getMany();

// Nested — use an object at the level you want to nest, array (or object)
// for the leaves
await PostRepository.qb().leftJoinsAndSelects({ user: ['profile'] }).getMany();
await UserRepository.qb().leftJoinsAndSelects({ posts: { user: ['profile'] } }).getMany();

// The alias is the relation name, so you reference it directly in where:
await UserRepository.qb()
  .leftJoinsAndSelects(['profile'])
  .where('profile.bio = :bio', { bio: 'hello' })
  .getMany();
```

### Joining without hydrating (`joins` / `leftJoins`)

`joins()` and `leftJoins()` mirror `leftJoinsAndSelects()` — same array/object spec, same
relation-name aliases — but do **not** select the joined columns. Use them when you
want to filter or order by a related table without paying to hydrate it.

- `joins(spec)` → `INNER JOIN` (drops rows without a match)
- `leftJoins(spec)` → `LEFT JOIN` (keeps rows without a match)

```ts
// Only return users that have a profile
await UserRepository.qb().joins(['profile']).getMany();

// Keep everyone, but expose the profile alias for filtering/ordering
await UserRepository.qb()
  .leftJoins(['profile'])
  .where('profile.bio IS NOT NULL')
  .getMany();

// Nested
await PostRepository.qb().joins({ user: ['profile'] }).getMany();
```

The return type is unchanged — relations are not hydrated, so they remain optional on the entity.

### `joinsAndSelects` — filter and hydrate

`joinsAndSelects()` is the `INNER JOIN + SELECT` counterpart of `leftJoinsAndSelects()`:
it hydrates the relation *and* drops rows without a match. Same spec and
alias rules. Unlike `leftJoinsAndSelects` (which keeps relations nullable to reflect
the LEFT JOIN), the return type marks loaded relations as non-null.

```ts
// Only users that have a profile; `profile` is typed as present
const users = await UserRepository.qb().joinsAndSelects(['profile']).getMany();
users[0].profile.bio; // no optional chaining needed
```

### Naming a hydrated shape (`LeftJoinsAndSelects` / `JoinsAndSelects`)

When a function returns rows that have been hydrated by `leftJoinsAndSelects()` or
`joinsAndSelects()`, the inferred return type can be unwieldy to spell out. The
exported utility types `LeftJoinsAndSelects<Entity, Spec>` and
`JoinsAndSelects<Entity, Spec>` reuse the same nested-spec form to compute the
loaded entity shape, so you can annotate function signatures without copying the
inference by hand. Same nullability rules as the builders:

- `LeftJoinsAndSelects` — relations stay nullable (LEFT JOIN)
- `JoinsAndSelects` — relations become non-null (INNER JOIN)

```ts
import type { LeftJoinsAndSelects, JoinsAndSelects } from 'custom-typeorm-query-builder';

type UserWithProfile = LeftJoinsAndSelects<UserEntity, ['profile']>;
type PostWithUserAndProfile = JoinsAndSelects<PostEntity, { user: ['profile'] }>;

async function loadUser(id: string): Promise<UserWithProfile | null> {
  return UserRepository.qb().leftJoinsAndSelects(['profile']).where({ id }).getOne();
}
```

The `Spec` parameter is the same array/object form the builders accept, and
unknown keys or scalar columns are rejected at the type level.

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

`select` accepts a single column string, an array of columns, or a sub-query
plus an alias. Repeated calls append to the running selection list:

```ts
// Single column
await UserRepository.qb().select('users.name').getRawMany();

// Multiple columns
await UserRepository.qb().select(['users.name', 'users.age']).getRawMany();

// Appending across calls
await UserRepository.qb()
  .select('users.name')
  .select('users.age')
  .getRawMany();
```

A sub-query plus an alias embeds a scalar sub-query as an aliased column. When
it is the *first* select on the chain it replaces the default entity selection,
so the row contains only the aliased column. Chain an explicit `select(...)`
beforehand if you want to keep entity columns alongside it:

```ts
// Only the `oldCount` column comes back
await UserRepository.qb()
  .select(
    UserRepository.qb().select('COUNT(*)').where('users.age >= :min', { min: 40 }),
    'oldCount',
  )
  .getRawMany();

// Keep `users.id` alongside the sub-query column
await UserRepository.qb()
  .select('users.id')
  .select(
    UserRepository.qb().select('COUNT(*)').where('users.age >= :min', { min: 40 }),
    'oldCount',
  )
  .getRawMany();
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
await UserRepository.qb().where({ email }).getExistsNot();
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

There is intentionally no `forEachRaw` counterpart to `forEach`. With any
row-multiplying join in the chain, raw-row pagination would cut a single PK's
joined rows across a `LIMIT` boundary and the cursor would advance past the
leftover rows, silently skipping data.

### Immutability

Every chained call returns a fresh builder, so a base query can be safely reused as a starting point:

```ts
const activeUsers = UserRepository.qb().where({ status: 'active' });

const recentlyCreated = await activeUsers.orderBy({ created_at: 'DESC' }).take(10).getMany();
const total = await activeUsers.getCount();
```

## Peer dependencies

- `typeorm >= 0.3.0`
