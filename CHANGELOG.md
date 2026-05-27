# Changelog

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
