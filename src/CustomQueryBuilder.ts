import type { ObjectLiteral, Repository, EntityMetadata } from 'typeorm';

export class CustomQueryBuilderError extends Error {}

type UnwrapRelation<T> = NonNullable<T> extends (infer U)[] ? U : NonNullable<T>;

type ResolveEntity<Entity, Chain extends readonly string[]> =
  Chain extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
    ? Head extends keyof Entity
      ? ResolveEntity<UnwrapRelation<Entity[Head]>, Tail>
      : never
    : Entity;

type ApplyPathInner<Entity, Path extends readonly string[]> =
  Path extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
    ? Head extends keyof Entity
      ? Entity & {
        [K in Head]-?: NonNullable<Entity[Head]> extends (infer U)[]
          ? ApplyPathInner<NonNullable<U>, Tail>[]
          : ApplyPathInner<NonNullable<Entity[Head]>, Tail>;
      }
      : Entity
    : Entity;

type ApplyPathLeft<Entity, Path extends readonly string[]> =
  Path extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
    ? Head extends keyof Entity
      ? Entity & {
        [K in Head]-?: NonNullable<Entity[Head]> extends (infer U)[]
          ? ApplyPathLeft<NonNullable<U>, Tail>[]
          : ApplyPathLeft<NonNullable<Entity[Head]>, Tail> | null;
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

type JoinSpec<Entity> =
  | readonly RelationKey<Entity>[]
  | { [K in RelationKey<Entity>]?: JoinSpec<UnwrapRelation<Entity[K]>> };

type ApplyEagerLoadsNested<Value, NestedSpec> =
  NonNullable<Value> extends (infer U)[]
    ? ApplyEagerLoads<NonNullable<U>, NestedSpec>[]
    : ApplyEagerLoads<NonNullable<Value>, NestedSpec> | null;

type ApplyEagerLoads<Entity, Spec> =
  Spec extends readonly (infer Item)[]
    ? Entity & {
      [P in Extract<Item, keyof Entity>]-?:
        NonNullable<Entity[P]> extends (infer U)[] ? NonNullable<U>[] : NonNullable<Entity[P]> | null;
    }
    : Spec extends Record<string, unknown>
      ? Entity & {
        [K in Extract<keyof Spec, keyof Entity>]-?: ApplyEagerLoadsNested<Entity[K], Spec[K]>;
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

  private applyWhere(conditions: string | Partial<Entity>, parameters?: ObjectLiteral) {
    if (typeof conditions === 'string') {
      const { newCondition, newParameters } = this.rewriteParameters(conditions, parameters || {});

      this.qb.andWhere(`(${newCondition})`, newParameters);
    } else {
      const conditionsObject = conditions as ObjectLiteral;

      Object.keys(conditionsObject).forEach((key) => {
        if (conditionsObject[key] === null) {
          this.qb.andWhere(`(${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)} IS NULL)`);
        } else {
          const param = this.incrementParameter();

          this.qb.andWhere(`(${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)} = :${param})`, { [param]: conditionsObject[key] });
        }
      });
    }

    return this;
  }

  where(conditions: string | Partial<Entity>, parameters?: ObjectLiteral): QueryBuilder<Entity, Projected> {
    return this.clone().applyWhere(conditions, parameters);
  }

  private applyWhereNot(conditions: string | Partial<Entity>, parameters?: ObjectLiteral) {
    if (typeof conditions === 'string') {
      const { newCondition, newParameters } = this.rewriteParameters(conditions, parameters || {});

      this.qb.andWhere(`NOT (${newCondition})`, newParameters);
    } else {
      const conditionsObject = conditions as ObjectLiteral;

      Object.keys(conditionsObject).forEach((key) => {
        if (conditionsObject[key] === null) {
          this.qb.andWhere(`(${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)} IS NOT NULL)`);
        } else {
          const param = this.incrementParameter();

          this.qb.andWhere(`(${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)} != :${param})`, { [param]: conditionsObject[key] });
        }
      });
    }

    return this;
  }

  whereNot(conditions: string | Partial<Entity>, parameters?: ObjectLiteral): QueryBuilder<Entity, Projected> {
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
      spec: Record<string, unknown> | readonly string[],
      parentAlias: string,
      parentMetadata: EntityMetadata,
      mode: 'leftJoinAndSelect' | 'innerJoin' | 'leftJoin',
    }
  ) {
    if (Array.isArray(spec)) {
      spec.forEach((relation) => this.addJoinedRelation({ relation, nested: undefined, parentAlias, parentMetadata, mode }));
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
      mode: 'leftJoinAndSelect' | 'innerJoin' | 'leftJoin',
    }
  ) {
    const relationMetadata = parentMetadata.findRelationWithPropertyPath(relation);

    if (!relationMetadata) {
      throw new CustomQueryBuilderError(`Relation "${relation}" not found on ${parentMetadata.name}`);
    }

    const newAlias = relationMetadata.inverseEntityMetadata.tableName;

    this.qb[mode](`${parentAlias}.${relation}`, newAlias);

    if (nested) {
      this.applyRelationSpec({
        spec: nested as Record<string, unknown> | readonly string[],
        parentAlias: newAlias,
        parentMetadata: relationMetadata.inverseEntityMetadata,
        mode,
      });
    }
  }

  eagerLoads<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<ApplyEagerLoads<Entity, Spec>, Projected> {
    const res = this.clone<ApplyEagerLoads<Entity, Spec>>();

    return res.applyRelationSpec({
      spec: spec as Record<string, unknown> | readonly string[],
      parentAlias: res.alias,
      parentMetadata: res.repository.metadata,
      mode: 'leftJoinAndSelect',
    }) as unknown as QueryBuilder<ApplyEagerLoads<Entity, Spec>, Projected>;
  }

  joins<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    return res.applyRelationSpec({
      spec: spec as Record<string, unknown> | readonly string[],
      parentAlias: res.alias,
      parentMetadata: res.repository.metadata,
      mode: 'innerJoin',
    });
  }

  leftJoins<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<Entity, Projected> {
    const res = this.clone();

    return res.applyRelationSpec({
      spec: spec as Record<string, unknown> | readonly string[],
      parentAlias: res.alias,
      parentMetadata: res.repository.metadata,
      mode: 'leftJoin',
    });
  }

  private applyLoadRelationCountAndMap(
    mapTo: string,
    relationPath: string,
    alias?: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ) {
    if (condition) {
      const { newCondition, newParameters } = this.rewriteParameters(condition, parameters || {});

      this.qb.loadRelationCountAndMap(mapTo, relationPath, alias, (subQb) => subQb.andWhere(`(${newCondition})`, newParameters));
    } else {
      this.qb.loadRelationCountAndMap(mapTo, relationPath, alias);
    }

    return this;
  }

  loadRelationCountAndMap<const MapToProperty extends string, const Path extends readonly string[]>(
    mapTo: `${string}.${MapToProperty}`,
    relationPath: DottedRelation<Entity, Path>,
    alias?: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<Entity & { [Key in MapToProperty]-?: number }, Projected> {
    return this.clone<Entity & { [Key in MapToProperty]-?: number }>().applyLoadRelationCountAndMap(mapTo, relationPath, alias, condition, parameters);
  }

  private applyOrderBy(sort: string | { [Key in keyof Entity]?: 'ASC' | 'DESC' }, order?: 'ASC' | 'DESC' | undefined) {
    if (typeof sort === 'string') {
      this.qb.addOrderBy(sort, order);
    } else {
      Object.keys(sort).forEach((key) => {
        this.qb.addOrderBy(`${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)}`, (sort as Record<string, 'ASC' | 'DESC'>)[key]);
      });
    }

    return this;
  }

  orderBy(sort: string | { [Key in keyof Entity]?: 'ASC' | 'DESC' }, order?: 'ASC' | 'DESC' | undefined): QueryBuilder<Entity, Projected> {
    return this.clone().applyOrderBy(sort, order);
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

  select(selection: string[]): QueryBuilder<Entity, true> {
    return this.clone<Entity, true>().applySelect(selection);
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

  getRawOne() {
    return this.qb.getRawOne();
  }

  getRawMany() {
    return this.qb.getRawMany();
  }
}
