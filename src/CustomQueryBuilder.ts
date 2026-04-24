import type { ObjectLiteral, Repository, EntityMetadata } from 'typeorm';

export class CustomQueryBuilderError extends Error {}

type UnwrapRelation<T> = NonNullable<T> extends (infer U)[] ? U : NonNullable<T>;

type ResolveEntity<Entity, Chain extends readonly string[]> =
  Chain extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
    ? Head extends keyof Entity
      ? ResolveEntity<UnwrapRelation<Entity[Head]>, Tail>
      : never
    : Entity;

type ApplyPath<Entity, Path extends readonly string[]> =
  Path extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
    ? Head extends keyof Entity
      ? Entity & {
        [K in Head]-?: NonNullable<Entity[Head]> extends (infer U)[]
          ? ApplyPath<NonNullable<U>, Tail>[]
          : ApplyPath<NonNullable<Entity[Head]>, Tail>;
      }
      : Entity
    : Entity;

type DottedRelation<Entity, Path extends readonly string[]> =
  Path extends readonly [...infer Chain extends readonly string[], infer Leaf extends string]
    ? Leaf extends keyof ResolveEntity<Entity, Chain> & string
      ? `${string}.${Leaf}`
      : never
    : never;

type RelationKey<Entity> = {
  [K in keyof Entity]-?: NonNullable<Entity[K]> extends Date
    ? never
    : NonNullable<Entity[K]> extends object
      ? K
      : never;
}[keyof Entity];

type EagerLoadSpec<Entity> =
  | readonly RelationKey<Entity>[]
  | { [K in RelationKey<Entity>]?: EagerLoadSpec<UnwrapRelation<Entity[K]>> };

type ApplyEagerNested<Value, NestedSpec> =
  NonNullable<Value> extends (infer U)[]
    ? ApplyEagerLoad<NonNullable<U>, NestedSpec>[]
    : ApplyEagerLoad<NonNullable<Value>, NestedSpec>;

type ApplyEagerLoad<Entity, Spec> =
  Spec extends readonly (infer Item)[]
    ? Entity & {
      [P in Extract<Item, keyof Entity>]-?:
        NonNullable<Entity[P]> extends (infer U)[] ? NonNullable<U>[] : NonNullable<Entity[P]>;
    }
    : Spec extends Record<string, unknown>
      ? Entity & {
        [K in Extract<keyof Spec, keyof Entity>]-?: ApplyEagerNested<Entity[K], Spec[K]>;
      }
      : Entity;

type QueryBuilder<Entity extends ObjectLiteral, Projected extends boolean = false> =
  Omit<CustomQueryBuilder<Entity, Projected>, Projected extends true ? 'getOne' | 'getMany' | 'getOneOrFail' : never>;

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
    return `_param${this.config.parameterCount++}`;
  }

  private rewriteParameters(condition: string, parameters: ObjectLiteral) {
    let newCondition = condition;
    const newParameters: ObjectLiteral = {};

    Object.keys(parameters || {}).forEach((key) => {
      const param = this.incrementParameter();

      newCondition = newCondition.replace(new RegExp(`(?<!:):${key}\\b`, 'g'), `:${param}`);
      newParameters[param] = (parameters || {})[key];
    });

    return { newCondition, newParameters };
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

  where(conditions: string | Partial<Entity>, parameters?: ObjectLiteral): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    if (typeof conditions === 'string') {
      const { newCondition, newParameters } = res.rewriteParameters(conditions, parameters || {});

      res.qb.andWhere(`(${newCondition})`, newParameters);
    } else {
      const conditionsObject = conditions as ObjectLiteral;

      Object.keys(conditionsObject).forEach((key) => {
        if (conditionsObject[key] === null) {
          res.qb.andWhere(`(${res.quoteColumnName(res.alias)}.${res.quoteColumnName(key)} IS NULL)`);
        } else {
          const param = res.incrementParameter();

          res.qb.andWhere(`(${res.quoteColumnName(res.alias)}.${res.quoteColumnName(key)} = :${param})`, { [param]: conditionsObject[key] });
        }
      });
    }

    return res;
  }

  whereNot(conditions: string | Partial<Entity>, parameters?: ObjectLiteral): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    if (typeof conditions === 'string') {
      const { newCondition, newParameters } = res.rewriteParameters(conditions, parameters || {});

      res.qb.andWhere(`NOT (${newCondition})`, newParameters);
    } else {
      const conditionsObject = conditions as ObjectLiteral;

      Object.keys(conditionsObject).forEach((key) => {
        if (conditionsObject[key] === null) {
          res.qb.andWhere(`(${res.quoteColumnName(res.alias)}.${res.quoteColumnName(key)} IS NOT NULL)`);
        } else {
          const param = res.incrementParameter();

          res.qb.andWhere(`(${res.quoteColumnName(res.alias)}.${res.quoteColumnName(key)} != :${param})`, { [param]: conditionsObject[key] });
        }
      });
    }

    return res;
  }

  leftJoinAndSelect<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<ApplyPath<Entity, Path>, Projected> {
    const res = this.clone<ApplyPath<Entity, Path>>();

    if (condition) {
      const { newCondition, newParameters } = res.rewriteParameters(condition, parameters || {});

      res.qb.leftJoinAndSelect(relationPath, newAlias, newCondition, newParameters);
    } else {
      res.qb.leftJoinAndSelect(relationPath, newAlias);
    }

    return res;
  }

  leftJoin<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    if (condition) {
      const { newCondition, newParameters } = res.rewriteParameters(condition, parameters || {});

      res.qb.leftJoin(relationPath, newAlias, newCondition, newParameters);
    } else {
      res.qb.leftJoin(relationPath, newAlias);
    }

    return res;
  }

  innerJoinAndSelect<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<ApplyPath<Entity, Path>, Projected> {
    const res = this.clone<ApplyPath<Entity, Path>>();

    if (condition) {
      const { newCondition, newParameters } = res.rewriteParameters(condition, parameters || {});

      res.qb.innerJoinAndSelect(relationPath, newAlias, newCondition, newParameters);
    } else {
      res.qb.innerJoinAndSelect(relationPath, newAlias);
    }

    return res;
  }

  innerJoin<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    if (condition) {
      const { newCondition, newParameters } = res.rewriteParameters(condition, parameters || {});

      res.qb.innerJoin(relationPath, newAlias, newCondition, newParameters);
    } else {
      res.qb.innerJoin(relationPath, newAlias);
    }

    return res;
  }

  eagerLoad<const Spec extends EagerLoadSpec<Entity>>(spec: Spec): QueryBuilder<ApplyEagerLoad<Entity, Spec>, Projected> {
    const res = this.clone<ApplyEagerLoad<Entity, Spec>>();

    res.applyEagerLoadSpec({
      spec: spec as Record<string, unknown> | readonly string[],
      parentAlias: res.alias,
      parentMetadata: res.repository.metadata,
    });

    return res;
  }

  private applyEagerLoadSpec(
    { spec, parentAlias, parentMetadata }:
    { spec: Record<string, unknown> | readonly string[], parentAlias: string, parentMetadata: EntityMetadata }
  ) {
    if (Array.isArray(spec)) {
      spec.forEach((relation) => this.addEagerLoadRelation({ relation, nested: undefined, parentAlias, parentMetadata }));
      return;
    }

    const obj = spec as Record<string, unknown>;

    Object.keys(obj).forEach((relation) => this.addEagerLoadRelation({ relation, nested: obj[relation], parentAlias, parentMetadata }));
  }

  private addEagerLoadRelation(
    { relation, nested, parentAlias, parentMetadata }:
    {
      relation: string,
      nested: unknown,
      parentAlias: string,
      parentMetadata: EntityMetadata,
    }
  ) {
    const relationMetadata = parentMetadata.findRelationWithPropertyPath(relation);

    if (!relationMetadata) {
      throw new CustomQueryBuilderError(`Relation "${relation}" not found on ${parentMetadata.name}`);
    }

    const newAlias = relationMetadata.inverseEntityMetadata.tableName;

    this.qb.leftJoinAndSelect(`${parentAlias}.${relation}`, newAlias);

    if (nested) {
      this.applyEagerLoadSpec({
        spec: nested as Record<string, unknown> | readonly string[],
        parentAlias: newAlias,
        parentMetadata: relationMetadata.inverseEntityMetadata,
      });
    }
  }

  loadRelationCountAndMap<const MapToProperty extends string, const Path extends readonly string[]>(
    mapTo: `${string}.${MapToProperty}`,
    relationPath: DottedRelation<Entity, Path>,
    alias?: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<Entity & { [Key in MapToProperty]-?: number }, Projected> {
    const res = this.clone<Entity & { [Key in MapToProperty]-?: number }>();

    if (condition) {
      const { newCondition, newParameters } = res.rewriteParameters(condition, parameters || {});

      res.qb.loadRelationCountAndMap(mapTo, relationPath, alias, (subQb) => subQb.andWhere(`(${newCondition})`, newParameters));
    } else {
      res.qb.loadRelationCountAndMap(mapTo, relationPath, alias);
    }

    return res;
  }

  orderBy(sort: string | { [Key in keyof Entity]?: 'ASC' | 'DESC' }, order?: 'ASC' | 'DESC' | undefined): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    if (typeof sort === 'string') {
      res.qb.addOrderBy(sort, order);
    } else {
      Object.keys(sort).forEach((key) => {
        res.qb.addOrderBy(`${res.quoteColumnName(res.alias)}.${res.quoteColumnName(key)}`, (sort as Record<string, 'ASC' | 'DESC'>)[key]);
      });
    }

    return res;
  }

  groupBy(group: string): QueryBuilder<Entity, Projected> {
    const res = this.clone();
    res.qb.addGroupBy(group);
    return res;
  }

  skip(count: number): QueryBuilder<Entity, Projected> {
    const res = this.clone();
    res.qb.skip(count);
    return res;
  }

  take(count: number): QueryBuilder<Entity, Projected> {
    const res = this.clone();
    res.qb.take(count);
    return res;
  }

  limit(count: number): QueryBuilder<Entity, Projected> {
    const res = this.clone();
    res.qb.limit(count);
    return res;
  }

  select(selection: string[]): QueryBuilder<Entity, true> {
    const res = this.clone<Entity, true>();

    if (res.config.selects.length > 0) {
      res.qb.addSelect(selection);
    } else {
      res.qb.select(selection);
    }

    res.config.selects.push(...selection);

    return res;
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

  setLock(lockMode: 'optimistic' | 'pessimistic_read' | 'pessimistic_write' | 'dirty_read', lockVersion?: number | Date): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    if (lockMode === 'optimistic') {
      if (lockVersion === undefined) throw new Error('Lock version must be provided for optimistic locking');

      res.qb.setLock(lockMode, lockVersion);
    } else {
      res.qb.setLock(lockMode);
    }

    return res;
  }

  delete() {
    return this.qb.clone().delete().execute();
  }

  update(updates: { [Key in keyof Entity]?: Entity[Key] | (() => string) }, parameters?: ObjectLiteral) {
    const cloned = this.clone();
    const updateQb = cloned.qb.update();

    const parameterNameMap = Object.keys(parameters || {}).reduce((acc, cur) => {
      acc[cur] = cloned.incrementParameter();
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

  distinct(distinct: boolean = true): QueryBuilder<Entity, Projected> {
    const res = this.clone();
    res.qb.distinct(distinct);
    return res;
  }

  getSql() {
    return this.qb.getSql();
  }

  getExists() {
    return this.qb.getExists();
  }

  getRawOne() {
    return this.qb.getRawOne();
  }

  getRawMany() {
    return this.qb.getRawMany();
  }
}
