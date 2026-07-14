# Changelog

## 0.7.0

### Added

- Repository delegation: every method of the repository passed to the constructor is now
  available directly on the builder instance (e.g. `UserRepository.qb().findOneBy(...)`).
- Scopes: a repository method that returns a `CustomQueryBuilder` continues the current chain
  when called on a builder — its conditions are merged onto the builder it was called on
  (`UserRepository.qb().where(...).adults()`). Scopes compose in any order, including after a
  relation-widening join, and the resulting relation types are preserved. The builder's own
  `update`/`delete` take precedence over the repository's same-named methods.

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
