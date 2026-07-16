# Changelog

## 0.7.0

### Added

- `defineQueryBuilder(repository, extensions)` — attach reusable, chainable custom
  filter methods to a repository's builder. Each method runs with `this` bound to the
  builder and returns a builder that still carries the custom methods, so custom and
  built-in calls chain in any order. Extension names that collide with a built-in
  method are rejected at compile time. It returns a factory
  `(repository, alias) => builder`; pass the live repository (e.g. `this` from a `qb()`
  wrapper) so the builder keeps that repository's `EntityManager` — including inside a
  transaction. The repository handed to `defineQueryBuilder` is used only to infer the
  entity and extension types; pass a thunk (`() => repository`) to defer referencing it
  through a forward reference or import cycle.
- Exported type `QueryBuilderExtensions<Entity, Ext>` — the extensions-argument type of
  `defineQueryBuilder`, for wrapping it in a base-repository helper that threads the
  extensions into a shared `qb()`.

## 0.6.0

### Fixed

- `forEach()` now returns a re-iterable `AsyncIterable` instead of a one-shot `AsyncGenerator`,
  so the same returned value can be iterated more than once (each `for await` runs a fresh
  keyset-paginated scan). Existing `for await (... of qb.forEach())` usage is unchanged.

## 0.5.0

### Added

- Exported utility types `LeftJoinsAndSelects<Entity, Spec>` and `JoinsAndSelects<Entity, Spec>`
  for annotating return types of functions that hydrate relations via
  `leftJoinsAndSelects()`/`joinsAndSelects()`.

## 0.4.0

### Breaking changes

- Removed `loadRelationCountAndMap`.
- Bumped TypeORM dependency to `^1.0.0`.

### Added

- `all()` — no-op filter that returns a fresh, unfiltered builder clone.
- `none()` — returns a builder that matches no rows.
- `select(subquery, alias)` overload for embedding a scalar sub-query as an aliased column.

## 0.3.0

### Added

- `getExistsNot()` — convenience inverse of `getExists()`.

## 0.2.1

### Fixed

- handle spread parameters (`:...names`) correctly.
- Parameter keys are escaped in the rewrite regex.

## 0.2.0

### Added

- `joins()` and `leftJoins()` — join without selecting.
- `joinsAndSelects()` and `leftJoinsAndSelects()` — nested spec form, accepts arrays, objects, or mixed.
- `loadRelationCountAndMap()` with full path typing.
- `getRawQueryBuilder()` — escape hatch returning a cloned TypeORM builder.
- Array values in `where` / `whereNot` (emits `IN (...)` / `NOT IN (...)`).
- Parameter support in `orderBy`.

### Removed

- `forEachRaw`.

### Fixed

- Outer-join return types.
- `orderBy` column quoting.
- MySQL-specific issues.

## 0.1.0

Initial release.
