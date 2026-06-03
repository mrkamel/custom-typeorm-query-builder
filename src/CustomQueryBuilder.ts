import type { ObjectLiteral, Repository, EntityMetadata } from 'typeorm';

export class CustomQueryBuilderError extends Error {}

declare const relationBrand: unique symbol;

export type Relation<T> = {
  readonly [relationBrand]: T;
};

type LoadedRelation<T> =
  T extends { readonly [relationBrand]: infer U }
    ? Exclude<U, undefined>
    : Exclude<T, undefined>;

type UnwrapRelation<T> =
  NonNullable<LoadedRelation<T>> extends (infer U)[]
    ? U
    : NonNullable<LoadedRelation<T>>;

type ResolveEntity<Entity, Chain extends readonly string[]> =
  Chain extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
    ? Head extends keyof Entity
      ? ResolveEntity<UnwrapRelation<Entity[Head]>, Tail>
      : never
    : Entity;

type KeysInItem<Item> =
  Item extends string ? Item
  : Item extends Record<string, unknown> ? Extract<keyof Item, string>
  : never;

type KeysInSpec<Spec> =
  Spec extends readonly (infer Item)[] ? KeysInItem<Item>
  : Spec extends Record<string, unknown> ? Extract<keyof Spec, string>
  : never;

type ApplyPathInner<Entity, Path extends readonly string[]> =
  Path extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
    ? Head extends keyof Entity
      ? Omit<Entity, Head> & {
        [K in Head]: NonNullable<LoadedRelation<Entity[Head]>> extends (infer U)[]
          ? ApplyPathInner<U, Tail>[]
          : ApplyPathInner<NonNullable<LoadedRelation<Entity[Head]>>, Tail>;
      }
      : Entity
    : Entity;

type ApplyPathLeft<Entity, Path extends readonly string[]> =
  Path extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
    ? Head extends keyof Entity
      ? Omit<Entity, Head> & {
        [K in Head]: NonNullable<LoadedRelation<Entity[Head]>> extends (infer U)[]
          ? ApplyPathLeft<U, Tail>[]
          : ApplyPathLeft<NonNullable<LoadedRelation<Entity[Head]>>, Tail> | Extract<LoadedRelation<Entity[Head]>, null>;
      }
      : Entity
    : Entity;

type DottedRelation<Entity, Path extends readonly string[]> =
  Path extends readonly [...infer Chain extends readonly string[], infer Leaf extends string]
    ? Leaf extends keyof ResolveEntity<Entity, Chain> & string
      ? `${string}.${Leaf}`
      : never
    : never;

type Scalar = string | number | boolean;

type WhereObjectConditions<Entity> = {
  [K in keyof Entity]?:
    NonNullable<Entity[K]> extends Relation<unknown>
      ? never
      : NonNullable<Entity[K]> extends readonly unknown[]
        ? never
        : NonNullable<Entity[K]> extends Scalar
          ? Entity[K] | NonNullable<Entity[K]>[]
          : Scalar | Scalar[] | (null extends Entity[K] ? null : never);
};

// The RelationKey generic type gates the allowed keys being passed to
// `leftJoinsAndSelects` / `joinsAndSelects` / `joins` / `leftJoins`.
// It's best-effort: it picks any non-Date object field. Date is carved
// out because timestamp columns are the most common false positive, but
// other transformer-wrapped classes and jsonb objects still slip through.

type RelationKey<Entity> = {
  [K in keyof Entity]-?: NonNullable<Entity[K]> extends Date
    ? never
    : NonNullable<Entity[K]> extends object
      ? K
      : never;
}[keyof Entity];

type UnionToIntersection<Union> =
  (Union extends unknown ? (k: Union) => void : never) extends (k: infer Intersection) => void ? Intersection : never;

type JoinSpecItem<Entity> =
  | RelationKey<Entity>
  | { [K in RelationKey<Entity>]?: JoinSpec<UnwrapRelation<Entity[K]>> };

type JoinSpec<Entity> =
  | readonly JoinSpecItem<Entity>[]
  | { [K in RelationKey<Entity>]?: JoinSpec<UnwrapRelation<Entity[K]>> };

type ApplyLeftJoinsAndSelectsNested<Value, NestedSpec> =
  NonNullable<LoadedRelation<Value>> extends (infer U)[]
    ? ApplyLeftJoinsAndSelects<U, NestedSpec>[]
    : ApplyLeftJoinsAndSelects<NonNullable<LoadedRelation<Value>>, NestedSpec> | Extract<LoadedRelation<Value>, null>;

type ApplyLeftJoinsAndSelectsArrayItem<Entity, Item> =
  Item extends keyof Entity
    ? { [P in Item]: LoadedRelation<Entity[P]> }
    : Item extends Record<string, unknown>
      ? { [K in Extract<keyof Item, keyof Entity>]: ApplyLeftJoinsAndSelectsNested<Entity[K], Item[K]> }
      : never;

type ApplyLeftJoinsAndSelects<Entity, Spec> =
  Spec extends readonly (infer Item)[]
    ? Omit<Entity, KeysInSpec<Spec>> & UnionToIntersection<ApplyLeftJoinsAndSelectsArrayItem<Entity, Item>>
    : Spec extends Record<string, unknown>
      ? Omit<Entity, KeysInSpec<Spec>> & {
        [K in Extract<keyof Spec, keyof Entity>]: ApplyLeftJoinsAndSelectsNested<Entity[K], Spec[K]>;
      }
      : Entity;

type ApplyJoinsAndSelectsNested<Value, NestedSpec> =
  NonNullable<LoadedRelation<Value>> extends (infer U)[]
    ? ApplyJoinsAndSelects<U, NestedSpec>[]
    : ApplyJoinsAndSelects<NonNullable<LoadedRelation<Value>>, NestedSpec>;

type ApplyJoinsAndSelectsArrayItem<Entity, Item> =
  Item extends keyof Entity
    ? { [P in Item]: NonNullable<LoadedRelation<Entity[P]>> }
    : Item extends Record<string, unknown>
      ? { [K in Extract<keyof Item, keyof Entity>]: ApplyJoinsAndSelectsNested<Entity[K], Item[K]> }
      : never;

type ApplyJoinsAndSelects<Entity, Spec> =
  Spec extends readonly (infer Item)[]
    ? Omit<Entity, KeysInSpec<Spec>> & UnionToIntersection<ApplyJoinsAndSelectsArrayItem<Entity, Item>>
    : Spec extends Record<string, unknown>
      ? Omit<Entity, KeysInSpec<Spec>> & {
        [K in Extract<keyof Spec, keyof Entity>]: ApplyJoinsAndSelectsNested<Entity[K], Spec[K]>;
      }
      : Entity;

type QueryBuilder<Entity extends ObjectLiteral, Projected extends boolean = false> =
  Omit<CustomQueryBuilder<Entity, Projected>, Projected extends true ? 'getOne' | 'getMany' | 'getOneOrFail' | 'forEach' : never>;

export class CustomQueryBuilder<Entity extends ObjectLiteral, Projected extends boolean = false> {
  private qb = this.repository.createQueryBuilder(this.alias);

  private config = {
    parameterCount: 0,
    selects: [] as string[],
  };

  constructor(private repository: Repository<Entity>, private alias: string) {}

  private quoteColumnName(column: string) {
    return this.repository.manager.connection.driver.escape(column);
  }

  private incrementParameter() {
    return `__param${this.config.parameterCount++}`;
  }

  private rewriteParameters(condition: string, parameters: ObjectLiteral) {
    let newCondition = condition;
    const newParameters: ObjectLiteral = {};

    Object.keys(parameters || {}).forEach((key) => {
      const param = this.incrementParameter();
      const escapedKey = key.replace(/[^A-Za-z0-9_]/g, '\\$&');

      newCondition = newCondition.replace(new RegExp(`(?<!:):(\\.\\.\\.)?${escapedKey}\\b`, 'g'), `:$1${param}`);
      newParameters[param] = (parameters || {})[key];
    });

    return { newCondition, newParameters };
  }

  getRawQueryBuilder() {
    return this.qb.clone();
  }

  clone<NewEntity extends ObjectLiteral = Entity, NewProjected extends boolean = Projected>(): CustomQueryBuilder<NewEntity, NewProjected> {
    const res = new CustomQueryBuilder<NewEntity, NewProjected>(this.repository as unknown as Repository<NewEntity>, this.alias);

    res.qb = this.qb.clone() as unknown as typeof res.qb;

    res.config = {
      parameterCount: this.config.parameterCount,
      selects: [...this.config.selects],
    };

    return res;
  }

  all() {
    return this.where({});
  }

  none() {
    return this.where('1 = 0');
  }

  private applyWhere(conditions: string | WhereObjectConditions<Entity>, parameters?: ObjectLiteral) {
    if (typeof conditions === 'string') {
      const { newCondition, newParameters } = this.rewriteParameters(conditions, parameters || {});

      this.qb.andWhere(`(${newCondition})`, newParameters);
    } else {
      const conditionsObject = conditions as ObjectLiteral;

      Object.keys(conditionsObject).forEach((key) => {
        const value = conditionsObject[key];
        const column = `${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)}`;

        if (value === null) {
          this.qb.andWhere(`(${column} IS NULL)`);
        } else if (Array.isArray(value)) {
          if (value.length === 0) {
            this.qb.andWhere('(1 = 0)');
          } else {
            const param = this.incrementParameter();
            this.qb.andWhere(`(${column} IN (:...${param}))`, { [param]: value });
          }
        } else {
          const param = this.incrementParameter();
          this.qb.andWhere(`(${column} = :${param})`, { [param]: value });
        }
      });
    }

    return this;
  }

  where(conditions: string | WhereObjectConditions<Entity>, parameters?: ObjectLiteral): QueryBuilder<Entity, Projected> {
    return this.clone().applyWhere(conditions, parameters);
  }

  private applyWhereNot(conditions: string | WhereObjectConditions<Entity>, parameters?: ObjectLiteral) {
    if (typeof conditions === 'string') {
      const { newCondition, newParameters } = this.rewriteParameters(conditions, parameters || {});

      this.qb.andWhere(`NOT (${newCondition})`, newParameters);
    } else {
      const conditionsObject = conditions as ObjectLiteral;

      Object.keys(conditionsObject).forEach((key) => {
        const value = conditionsObject[key];
        const column = `${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)}`;

        if (value === null) {
          this.qb.andWhere(`(${column} IS NOT NULL)`);
        } else if (Array.isArray(value)) {
          if (value.length === 0) {
            this.qb.andWhere('(1 = 1)');
          } else {
            const param = this.incrementParameter();
            this.qb.andWhere(`(${column} NOT IN (:...${param}))`, { [param]: value });
          }
        } else {
          const param = this.incrementParameter();
          this.qb.andWhere(`(${column} != :${param})`, { [param]: value });
        }
      });
    }

    return this;
  }

  whereNot(conditions: string | WhereObjectConditions<Entity>, parameters?: ObjectLiteral): QueryBuilder<Entity, Projected> {
    return this.clone().applyWhereNot(conditions, parameters);
  }

  private applyJoin(
    mode: 'leftJoinAndSelect' | 'leftJoin' | 'innerJoinAndSelect' | 'innerJoin',
    relationPath: string,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ) {
    if (condition) {
      const { newCondition, newParameters } = this.rewriteParameters(condition, parameters || {});

      this.qb[mode](relationPath, newAlias, newCondition, newParameters);
    } else {
      this.qb[mode](relationPath, newAlias);
    }

    return this;
  }

  leftJoinAndSelect<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<ApplyPathLeft<Entity, Path>, Projected> {
    return this.clone<ApplyPathLeft<Entity, Path>>().applyJoin('leftJoinAndSelect', relationPath, newAlias, condition, parameters);
  }

  leftJoin<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<Entity, Projected> {
    return this.clone().applyJoin('leftJoin', relationPath, newAlias, condition, parameters);
  }

  innerJoinAndSelect<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<ApplyPathInner<Entity, Path>, Projected> {
    return this.clone<ApplyPathInner<Entity, Path>>().applyJoin('innerJoinAndSelect', relationPath, newAlias, condition, parameters);
  }

  innerJoin<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<Entity, Projected> {
    return this.clone().applyJoin('innerJoin', relationPath, newAlias, condition, parameters);
  }

  private applyRelationSpec(
    { spec, parentAlias, parentMetadata, mode }:
    {
      spec: Record<string, unknown> | readonly (string | Record<string, unknown>)[],
      parentAlias: string,
      parentMetadata: EntityMetadata,
      mode: 'leftJoinAndSelect' | 'innerJoinAndSelect' | 'innerJoin' | 'leftJoin',
    }
  ) {
    if (Array.isArray(spec)) {
      spec.forEach((item) => {
        if (typeof item === 'string') {
          this.addJoinedRelation({ relation: item, nested: undefined, parentAlias, parentMetadata, mode });
        } else {
          const nestedObj = item as Record<string, unknown>;

          Object.keys(nestedObj).forEach((relation) => this.addJoinedRelation({ relation, nested: nestedObj[relation], parentAlias, parentMetadata, mode }));
        }
      });

      return this;
    }

    const obj = spec as Record<string, unknown>;

    Object.keys(obj).forEach((relation) => this.addJoinedRelation({ relation, nested: obj[relation], parentAlias, parentMetadata, mode }));

    return this;
  }

  private addJoinedRelation(
    { relation, nested, parentAlias, parentMetadata, mode }:
    {
      relation: string,
      nested: unknown,
      parentAlias: string,
      parentMetadata: EntityMetadata,
      mode: 'leftJoinAndSelect' | 'innerJoinAndSelect' | 'innerJoin' | 'leftJoin',
    }
  ) {
    const relationMetadata = parentMetadata.findRelationWithPropertyPath(relation);

    if (!relationMetadata) {
      throw new CustomQueryBuilderError(`Relation "${relation}" not found on ${parentMetadata.name}`);
    }

    // Use the relation property name as the alias (flat, not parent-prefixed for nested).
    // Collisions across multiple paths to the same relation name are the user's problem
    // to resolve via the single-relation join methods.

    const newAlias = relationMetadata.propertyName;

    this.qb[mode](`${parentAlias}.${relation}`, newAlias);

    if (nested) {
      this.applyRelationSpec({
        spec: nested as Record<string, unknown> | readonly (string | Record<string, unknown>)[],
        parentAlias: newAlias,
        parentMetadata: relationMetadata.inverseEntityMetadata,
        mode,
      });
    }
  }

  leftJoinsAndSelects<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<ApplyLeftJoinsAndSelects<Entity, Spec>, Projected> {
    const res = this.clone<ApplyLeftJoinsAndSelects<Entity, Spec>>();

    return res.applyRelationSpec({
      spec: spec as Record<string, unknown> | readonly (string | Record<string, unknown>)[],
      parentAlias: res.alias,
      parentMetadata: res.repository.metadata,
      mode: 'leftJoinAndSelect',
    }) as unknown as QueryBuilder<ApplyLeftJoinsAndSelects<Entity, Spec>, Projected>;
  }

  joinsAndSelects<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<ApplyJoinsAndSelects<Entity, Spec>, Projected> {
    const res = this.clone<ApplyJoinsAndSelects<Entity, Spec>>();

    return res.applyRelationSpec({
      spec: spec as Record<string, unknown> | readonly (string | Record<string, unknown>)[],
      parentAlias: res.alias,
      parentMetadata: res.repository.metadata,
      mode: 'innerJoinAndSelect',
    }) as unknown as QueryBuilder<ApplyJoinsAndSelects<Entity, Spec>, Projected>;
  }

  joins<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    return res.applyRelationSpec({
      spec: spec as Record<string, unknown> | readonly (string | Record<string, unknown>)[],
      parentAlias: res.alias,
      parentMetadata: res.repository.metadata,
      mode: 'innerJoin',
    });
  }

  leftJoins<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    return res.applyRelationSpec({
      spec: spec as Record<string, unknown> | readonly (string | Record<string, unknown>)[],
      parentAlias: res.alias,
      parentMetadata: res.repository.metadata,
      mode: 'leftJoin',
    });
  }

  private applyOrderBy(
    sort: string | { [Key in keyof Entity]?: 'ASC' | 'DESC' },
    orderOrParameters?: 'ASC' | 'DESC' | ObjectLiteral,
  ) {
    if (typeof sort === 'string' && typeof orderOrParameters === 'string') {
      this.qb.addOrderBy(sort, orderOrParameters);
    } else if (typeof sort === 'string' && typeof orderOrParameters === 'object') {
      const match = sort.match(/\s+(ASC|DESC)\s*$/i);
      const finalSort = match ? sort.slice(0, match.index) : sort;
      const order = match ? (match[1].toUpperCase() as 'ASC' | 'DESC') : undefined;
      const { newCondition, newParameters } = this.rewriteParameters(finalSort, orderOrParameters);

      this.qb.setParameters(newParameters);
      this.qb.addOrderBy(newCondition, order);
    } else if (typeof sort === 'string') {
      this.qb.addOrderBy(sort);
    } else {
      Object.keys(sort).forEach((key) => {
        // TypeORM's take + *-to-many pagination forces us to pass it without quoting.
        this.qb.addOrderBy(`${this.alias}.${key}`, (sort as Record<string, 'ASC' | 'DESC'>)[key]);
      });
    }

    return this;
  }

  orderBy(sort: string, order?: 'ASC' | 'DESC'): QueryBuilder<Entity, Projected>;
  orderBy(sort: string, parameters: ObjectLiteral): QueryBuilder<Entity, Projected>;
  orderBy(sort: { [Key in keyof Entity]?: 'ASC' | 'DESC' }): QueryBuilder<Entity, Projected>;
  orderBy(
    sort: string | { [Key in keyof Entity]?: 'ASC' | 'DESC' },
    orderOrParameters?: 'ASC' | 'DESC' | ObjectLiteral,
  ): QueryBuilder<Entity, Projected> {
    return this.clone().applyOrderBy(sort, orderOrParameters);
  }

  private applyGroupBy(group: string) {
    this.qb.addGroupBy(group);
    return this;
  }

  groupBy(group: string): QueryBuilder<Entity, Projected> {
    return this.clone().applyGroupBy(group);
  }

  private applySkip(count: number) {
    this.qb.skip(count);
    return this;
  }

  skip(count: number): QueryBuilder<Entity, Projected> {
    return this.clone().applySkip(count);
  }

  private applyTake(count: number) {
    this.qb.take(count);
    return this;
  }

  take(count: number): QueryBuilder<Entity, Projected> {
    return this.clone().applyTake(count);
  }

  private applyLimit(count: number) {
    this.qb.limit(count);
    return this;
  }

  limit(count: number): QueryBuilder<Entity, Projected> {
    return this.clone().applyLimit(count);
  }

  private applySelect(selection: string[]) {
    if (this.config.selects.length > 0) {
      this.qb.addSelect(selection);
    } else {
      this.qb.select(selection);
    }

    this.config.selects.push(...selection);

    return this;
  }

  private applySubSelect(subquery: QueryBuilder<Entity, boolean>, alias: string) {
    const rawSubQb = subquery.getRawQueryBuilder();

    const { newCondition, newParameters } = this.rewriteParameters(
      rawSubQb.getQuery(),
      rawSubQb.getParameters(),
    );

    if (this.config.selects.length > 0) {
      this.qb.addSelect(`(${newCondition})`, alias);
    } else {
      this.qb.select(`(${newCondition})`, alias);
    }

    this.qb.setParameters(newParameters);

    this.config.selects.push(alias);

    return this;
  }

  select(selection: string): QueryBuilder<Entity, true>;
  select(selection: string[]): QueryBuilder<Entity, true>;
  select(subquery: QueryBuilder<Entity, boolean>, alias: string): QueryBuilder<Entity, true>;
  select(
    selectionOrSubquery: string | string[] | QueryBuilder<Entity, boolean>,
    alias?: string,
  ): QueryBuilder<Entity, true> {
    if (Array.isArray(selectionOrSubquery)) return this.clone<Entity, true>().applySelect(selectionOrSubquery);
    if (typeof selectionOrSubquery === 'string') return this.clone<Entity, true>().applySelect([selectionOrSubquery]);

    if (!alias) throw new CustomQueryBuilderError('Alias must be provided when selecting a subquery');

    return this.clone<Entity, true>().applySubSelect(selectionOrSubquery, alias);
  }

  getOne() {
    if (this.config.selects.length > 0) throw new CustomQueryBuilderError('getOne cannot be used after select');

    return this.qb.getOne();
  }

  getOneOrFail() {
    if (this.config.selects.length > 0) throw new CustomQueryBuilderError('getOneOrFail cannot be used after select');

    return this.qb.getOneOrFail();
  }

  getMany() {
    if (this.config.selects.length > 0) throw new CustomQueryBuilderError('getMany cannot be used after select');

    return this.qb.getMany();
  }

  getCount() {
    return this.qb.getCount();
  }

  getManyAndCount() {
    return this.qb.getManyAndCount();
  }

  async *forEach(options: { batchSize?: number } = {}): AsyncGenerator<Entity, void, undefined> {
    if (this.config.selects.length > 0) throw new CustomQueryBuilderError('forEach cannot be used after select');

    const batchSize = options.batchSize ?? 1000;
    const primaryColumns = this.repository.metadata.primaryColumns;

    if (primaryColumns.length === 0) {
      throw new CustomQueryBuilderError(`Cannot iterate ${this.repository.metadata.name}: no primary key`);
    }

    const columnList = primaryColumns.map((col) => `${this.alias}.${col.propertyName}`).join(', ');
    let cursor: unknown[] | undefined;

    while (true) {
      const batch = this.clone();

      batch.qb.skip().take().limit(); // Remove any prior skip/take/limit

      // First call replaces any prior limit and orderBy; subsequent calls append.
      batch.qb.orderBy(`${this.alias}.${primaryColumns[0].propertyName}`, 'ASC');
      primaryColumns.slice(1).forEach((col) => batch.qb.addOrderBy(`${this.alias}.${col.propertyName}`, 'ASC'));

      if (cursor) {
        const placeholders = primaryColumns.map((col) => `:_pk_${col.propertyName}`).join(', ');
        const parameters: ObjectLiteral = {};

        primaryColumns.forEach((col, index) => { parameters[`_pk_${col.propertyName}`] = cursor![index]; });

        const { newCondition, newParameters } = batch.rewriteParameters(`(${columnList}) > (${placeholders})`, parameters);

        batch.qb.andWhere(`(${newCondition})`, newParameters);
      }

      batch.qb.take(batchSize);

      const rows = await batch.qb.getMany();

      for (const row of rows) yield row;

      if (rows.length < batchSize) return;

      const last = rows[rows.length - 1] as ObjectLiteral;

      cursor = primaryColumns.map((col) => last[col.propertyName]);
    }
  }

  private applySetLock(lockMode: 'optimistic' | 'pessimistic_read' | 'pessimistic_write' | 'dirty_read', lockVersion?: number | Date) {
    if (lockMode === 'optimistic') {
      if (lockVersion === undefined) throw new Error('Lock version must be provided for optimistic locking');

      this.qb.setLock(lockMode, lockVersion);
    } else {
      this.qb.setLock(lockMode);
    }

    return this;
  }

  setLock(lockMode: 'optimistic' | 'pessimistic_read' | 'pessimistic_write' | 'dirty_read', lockVersion?: number | Date): QueryBuilder<Entity, Projected> {
    return this.clone().applySetLock(lockMode, lockVersion);
  }

  delete() {
    return this.qb.clone().delete().execute();
  }

  private applyUpdate(updates: { [Key in keyof Entity]?: Entity[Key] | (() => string) }, parameters?: ObjectLiteral) {
    const updateQb = this.qb.update();

    const parameterNameMap = Object.keys(parameters || {}).reduce((acc, cur) => {
      acc[cur] = this.incrementParameter();
      return acc;
    }, {} as Record<string, string>);

    const setValues: { [Key in keyof Entity]?: Entity[Key] | (() => string) } = {};

    (Object.keys(updates) as (keyof Entity)[]).forEach((key) => {
      const value = updates[key];

      if (typeof value === 'function') {
        let sqlExpression = (value as () => string)();

        Object.keys(parameterNameMap).forEach((originalName) => {
          sqlExpression = sqlExpression.replace(new RegExp(`(?<!:):${originalName}\\b`, 'g'), `:${parameterNameMap[originalName]}`);
        });

        setValues[key] = () => sqlExpression;
      } else {
        setValues[key] = value;
      }
    });

    updateQb.set(setValues);

    Object.keys(parameters || {}).forEach((key) => {
      updateQb.setParameter(parameterNameMap[key], (parameters || {})[key]);
    });

    return updateQb.execute();
  }

  update(updates: { [Key in keyof Entity]?: Entity[Key] | (() => string) }, parameters?: ObjectLiteral) {
    return this.clone().applyUpdate(updates, parameters);
  }

  private applyDistinct(distinct: boolean = true) {
    this.qb.distinct(distinct);
    return this;
  }

  distinct(distinct: boolean = true): QueryBuilder<Entity, Projected> {
    return this.clone().applyDistinct(distinct);
  }

  getSql() {
    return this.qb.getSql();
  }

  getExists() {
    return this.qb.getExists();
  }

  async getExistsNot() {
    return !(await this.qb.getExists());
  }

  getRawOne() {
    return this.qb.getRawOne();
  }

  getRawMany() {
    return this.qb.getRawMany();
  }
}
