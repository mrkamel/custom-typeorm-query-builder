import type { ObjectLiteral, Repository, EntityMetadata, SelectQueryBuilder } from 'typeorm';

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
          : ApplyPathLeft<NonNullable<Entity[Head]>, Tail> | Extract<Entity[Head], null>;
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
    NonNullable<Entity[K]> extends readonly unknown[]
      ? never
      : NonNullable<Entity[K]> extends Scalar
        ? Entity[K] | NonNullable<Entity[K]>[]
        : Scalar | Scalar[] | (null extends Entity[K] ? null : never);
};

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
  NonNullable<Value> extends (infer U)[]
    ? ApplyLeftJoinsAndSelects<NonNullable<U>, NestedSpec>[]
    : ApplyLeftJoinsAndSelects<NonNullable<Value>, NestedSpec> | Extract<Value, null>;

type ApplyLeftJoinsAndSelectsArrayItem<Entity, Item> =
  Item extends keyof Entity
    ? { [P in Item]-?: Exclude<Entity[P], undefined> }
    : Item extends Record<string, unknown>
      ? { [K in Extract<keyof Item, keyof Entity>]-?: ApplyLeftJoinsAndSelectsNested<Entity[K], Item[K]> }
      : never;

type ApplyLeftJoinsAndSelects<Entity, Spec> =
  Spec extends readonly (infer Item)[]
    ? Entity & UnionToIntersection<ApplyLeftJoinsAndSelectsArrayItem<Entity, Item>>
    : Spec extends Record<string, unknown>
      ? Entity & {
        [K in Extract<keyof Spec, keyof Entity>]-?: ApplyLeftJoinsAndSelectsNested<Entity[K], Spec[K]>;
      }
      : Entity;

type ApplyJoinsAndSelectsNested<Value, NestedSpec> =
  NonNullable<Value> extends (infer U)[]
    ? ApplyJoinsAndSelects<NonNullable<U>, NestedSpec>[]
    : ApplyJoinsAndSelects<NonNullable<Value>, NestedSpec>;

type ApplyJoinsAndSelectsArrayItem<Entity, Item> =
  Item extends keyof Entity
    ? { [P in Item]-?: NonNullable<Entity[P]> extends (infer U)[] ? NonNullable<U>[] : NonNullable<Entity[P]> }
    : Item extends Record<string, unknown>
      ? { [K in Extract<keyof Item, keyof Entity>]-?: ApplyJoinsAndSelectsNested<Entity[K], Item[K]> }
      : never;

type ApplyJoinsAndSelects<Entity, Spec> =
  Spec extends readonly (infer Item)[]
    ? Entity & UnionToIntersection<ApplyJoinsAndSelectsArrayItem<Entity, Item>>
    : Spec extends Record<string, unknown>
      ? Entity & {
        [K in Extract<keyof Spec, keyof Entity>]-?: ApplyJoinsAndSelectsNested<Entity[K], Spec[K]>;
      }
      : Entity;

export type LeftJoinsAndSelects<Entity, Spec extends JoinSpec<Entity>> = ApplyLeftJoinsAndSelects<Entity, Spec>;
export type JoinsAndSelects<Entity, Spec extends JoinSpec<Entity>> = ApplyJoinsAndSelects<Entity, Spec>;

declare const CQB_BRAND: unique symbol;

// Re-types repository methods that return a builder (scopes) so the result continues the
// chain: the scope's entity is intersected with the chain's and the concrete repository type
// is preserved, making scope order irrelevant. Other methods pass through unchanged.

type ScopeMerge<Entity extends ObjectLiteral, Repo extends Repository<ObjectLiteral>> = {
  [K in keyof Repo]: Repo[K] extends (...args: infer A) => infer R
    ? R extends { readonly [CQB_BRAND]: { entity: infer E2, projected: infer P2 } }
      ? E2 extends ObjectLiteral
        ? P2 extends boolean
          ? (...args: A) => QueryBuilder<Entity & E2, P2, Repo>
          : Repo[K]
        : Repo[K]
      : Repo[K]
    : Repo[K];
};

type RepoMethods<Entity extends ObjectLiteral, Repo extends Repository<ObjectLiteral>> =
  Omit<ScopeMerge<Entity, Repo>, 'update' | 'delete'>;

type QueryBuilder<
  Entity extends ObjectLiteral,
  Projected extends boolean = false,
  Repo extends Repository<ObjectLiteral> = Repository<Entity>,
> = Omit<CustomQueryBuilderImpl<Entity, Projected, Repo>, Projected extends true ? 'getOne' | 'getMany' | 'getOneOrFail' | 'forEach' : never>
  & RepoMethods<Entity, Repo>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryBuilder = QueryBuilder<any, boolean>;

type JoinMode = 'leftJoinAndSelect' | 'leftJoin' | 'innerJoinAndSelect' | 'innerJoin';

type RelationSpecArg = Record<string, unknown> | readonly (string | Record<string, unknown>)[];

type LockMode = 'optimistic' | 'pessimistic_read' | 'pessimistic_write' | 'dirty_read';

type Op =
  | { kind: 'where'; conditions: string | ObjectLiteral; parameters?: ObjectLiteral }
  | { kind: 'whereNot'; conditions: string | ObjectLiteral; parameters?: ObjectLiteral }
  | { kind: 'join'; mode: JoinMode; relationPath: string; newAlias: string; condition?: string; parameters?: ObjectLiteral }
  | { kind: 'relationSpec'; spec: RelationSpecArg; mode: JoinMode }
  | { kind: 'orderBy'; sort: string | Record<string, 'ASC' | 'DESC'>; orderOrParameters?: 'ASC' | 'DESC' | ObjectLiteral }
  | { kind: 'groupBy'; group: string }
  | { kind: 'skip'; count: number }
  | { kind: 'take'; count: number }
  | { kind: 'limit'; count: number }
  | { kind: 'select'; selection: string[] }
  | { kind: 'subSelect'; subquery: CustomQueryBuilderImpl<ObjectLiteral, boolean>; alias: string }
  | { kind: 'setLock'; lockMode: LockMode; lockVersion?: number | Date }
  | { kind: 'distinct'; distinct: boolean };

type MaterializeState = { parameterCount: number; selects: string[] };

export class CustomQueryBuilderImpl<
  Entity extends ObjectLiteral,
  Projected extends boolean = false,
  Repo extends Repository<ObjectLiteral> = Repository<Entity>,
> {
  declare readonly [CQB_BRAND]: { entity: Entity, projected: Projected };

  private ops: readonly Op[] = [];

  constructor(private repository: Repo, private alias: string) {
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop === 'symbol' || Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }

        const value = (this.repository as unknown as Record<string, unknown>)[prop];

        if (typeof value !== 'function') return value;

        return (...args: unknown[]) => {
          const result = (value as (...callArgs: unknown[]) => unknown).apply(this.repository, args);

          if (result instanceof CustomQueryBuilderImpl) {
            return this.continueWith(result as CustomQueryBuilderImpl<ObjectLiteral, boolean, Repository<ObjectLiteral>>);
          }

          return result;
        };
      },
    }) as unknown as this;
  }

  private quoteColumnName(column: string) {
    return this.repository.manager.connection.driver.escape(column);
  }

  private incrementParameter(state: MaterializeState) {
    return `__param${state.parameterCount++}`;
  }

  private rewriteParameters(state: MaterializeState, condition: string, parameters: ObjectLiteral) {
    let newCondition = condition;
    const newParameters: ObjectLiteral = {};

    Object.keys(parameters || {}).forEach((key) => {
      const param = this.incrementParameter(state);
      const escapedKey = key.replace(/[^A-Za-z0-9_]/g, '\\$&');

      newCondition = newCondition.replace(new RegExp(`(?<!:):(\\.\\.\\.)?${escapedKey}\\b`, 'g'), `:$1${param}`);
      newParameters[param] = (parameters || {})[key];
    });

    return { newCondition, newParameters };
  }

  private withOps<
    NewEntity extends ObjectLiteral = Entity,
    NewProjected extends boolean = Projected,
    NewRepo extends Repository<ObjectLiteral> = Repository<NewEntity>,
  >(ops: readonly Op[]): CustomQueryBuilderImpl<NewEntity, NewProjected, NewRepo> {
    const res = new CustomQueryBuilderImpl<NewEntity, NewProjected, NewRepo>(this.repository as unknown as NewRepo, this.alias);

    res.ops = ops;

    return res;
  }

  private record<R>(op: Op): R {
    return this.withOps([...this.ops, op]) as unknown as R;
  }

  private continueWith(scope: CustomQueryBuilderImpl<ObjectLiteral, boolean, Repository<ObjectLiteral>>) {
    if (scope.repository !== this.repository) throw new CustomQueryBuilderError('Cannot merge a scope built for a different repository');
    if (scope.alias !== this.alias) throw new CustomQueryBuilderError('Cannot merge a scope built with a different alias');

    return this.withOps([...this.ops, ...scope.ops]);
  }

  private hasSelect() {
    return this.ops.some((op) => op.kind === 'select' || op.kind === 'subSelect');
  }

  private materialize(): { qb: SelectQueryBuilder<Entity>; state: MaterializeState } {
    const qb = this.repository.createQueryBuilder(this.alias) as unknown as SelectQueryBuilder<Entity>;
    const state: MaterializeState = { parameterCount: 0, selects: [] };

    for (const op of this.ops) this.replay(qb, state, op);

    return { qb, state };
  }

  private replay(qb: SelectQueryBuilder<Entity>, state: MaterializeState, op: Op) {
    switch (op.kind) {
      case 'where': this.replayWhere(qb, state, op.conditions, op.parameters); break;
      case 'whereNot': this.replayWhereNot(qb, state, op.conditions, op.parameters); break;
      case 'join': this.replayJoin(qb, state, op.mode, op.relationPath, op.newAlias, op.condition, op.parameters); break;
      case 'relationSpec':
        this.replayRelationSpec(qb, { spec: op.spec, parentAlias: this.alias, parentMetadata: this.repository.metadata, mode: op.mode });
        break;
      case 'orderBy': this.replayOrderBy(qb, state, op.sort, op.orderOrParameters); break;
      case 'groupBy': qb.addGroupBy(op.group); break;
      case 'skip': qb.skip(op.count); break;
      case 'take': qb.take(op.count); break;
      case 'limit': qb.limit(op.count); break;
      case 'select': this.replaySelect(qb, state, op.selection); break;
      case 'subSelect': this.replaySubSelect(qb, state, op.subquery, op.alias); break;
      case 'setLock': this.replaySetLock(qb, op.lockMode, op.lockVersion); break;
      case 'distinct': qb.distinct(op.distinct); break;
    }
  }

  getRawQueryBuilder() {
    return this.materialize().qb;
  }

  clone<
    NewEntity extends ObjectLiteral = Entity,
    NewProjected extends boolean = Projected,
    NewRepo extends Repository<ObjectLiteral> = Repository<NewEntity>,
  >(): CustomQueryBuilderImpl<NewEntity, NewProjected, NewRepo> {
    return this.withOps<NewEntity, NewProjected, NewRepo>([...this.ops]);
  }

  all() {
    return this.where({});
  }

  none() {
    return this.where('1 = 0');
  }

  private replayWhere(qb: SelectQueryBuilder<Entity>, state: MaterializeState, conditions: string | ObjectLiteral, parameters?: ObjectLiteral) {
    if (typeof conditions === 'string') {
      const { newCondition, newParameters } = this.rewriteParameters(state, conditions, parameters || {});

      qb.andWhere(`(${newCondition})`, newParameters);
    } else {
      const conditionsObject = conditions as ObjectLiteral;

      Object.keys(conditionsObject).forEach((key) => {
        const value = conditionsObject[key];
        const column = `${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)}`;

        if (value === null) {
          qb.andWhere(`(${column} IS NULL)`);
        } else if (Array.isArray(value)) {
          if (value.length === 0) {
            qb.andWhere('(1 = 0)');
          } else {
            const param = this.incrementParameter(state);
            qb.andWhere(`(${column} IN (:...${param}))`, { [param]: value });
          }
        } else {
          const param = this.incrementParameter(state);
          qb.andWhere(`(${column} = :${param})`, { [param]: value });
        }
      });
    }
  }

  where(conditions: string | WhereObjectConditions<Entity>, parameters?: ObjectLiteral): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'where', conditions, parameters });
  }

  private replayWhereNot(qb: SelectQueryBuilder<Entity>, state: MaterializeState, conditions: string | ObjectLiteral, parameters?: ObjectLiteral) {
    if (typeof conditions === 'string') {
      const { newCondition, newParameters } = this.rewriteParameters(state, conditions, parameters || {});

      qb.andWhere(`NOT (${newCondition})`, newParameters);
    } else {
      const conditionsObject = conditions as ObjectLiteral;

      Object.keys(conditionsObject).forEach((key) => {
        const value = conditionsObject[key];
        const column = `${this.quoteColumnName(this.alias)}.${this.quoteColumnName(key)}`;

        if (value === null) {
          qb.andWhere(`(${column} IS NOT NULL)`);
        } else if (Array.isArray(value)) {
          if (value.length === 0) {
            qb.andWhere('(1 = 1)');
          } else {
            const param = this.incrementParameter(state);
            qb.andWhere(`(${column} NOT IN (:...${param}))`, { [param]: value });
          }
        } else {
          const param = this.incrementParameter(state);
          qb.andWhere(`(${column} != :${param})`, { [param]: value });
        }
      });
    }
  }

  whereNot(conditions: string | WhereObjectConditions<Entity>, parameters?: ObjectLiteral): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'whereNot', conditions, parameters });
  }

  private replayJoin(
    qb: SelectQueryBuilder<Entity>,
    state: MaterializeState,
    mode: JoinMode,
    relationPath: string,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ) {
    if (condition) {
      const { newCondition, newParameters } = this.rewriteParameters(state, condition, parameters || {});

      qb[mode](relationPath, newAlias, newCondition, newParameters);
    } else {
      qb[mode](relationPath, newAlias);
    }
  }

  leftJoinAndSelect<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<ApplyPathLeft<Entity, Path>, Projected, Repo> {
    return this.record({ kind: 'join', mode: 'leftJoinAndSelect', relationPath, newAlias, condition, parameters });
  }

  leftJoin<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'join', mode: 'leftJoin', relationPath, newAlias, condition, parameters });
  }

  innerJoinAndSelect<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<ApplyPathInner<Entity, Path>, Projected, Repo> {
    return this.record({ kind: 'join', mode: 'innerJoinAndSelect', relationPath, newAlias, condition, parameters });
  }

  innerJoin<const Path extends readonly string[]>(
    relationPath: DottedRelation<Entity, Path>,
    newAlias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'join', mode: 'innerJoin', relationPath, newAlias, condition, parameters });
  }

  private replayRelationSpec(
    qb: SelectQueryBuilder<Entity>,
    { spec, parentAlias, parentMetadata, mode }:
    {
      spec: RelationSpecArg,
      parentAlias: string,
      parentMetadata: EntityMetadata,
      mode: JoinMode,
    }
  ) {
    if (Array.isArray(spec)) {
      spec.forEach((item) => {
        if (typeof item === 'string') {
          this.addJoinedRelation(qb, { relation: item, nested: undefined, parentAlias, parentMetadata, mode });
        } else {
          const nestedObj = item as Record<string, unknown>;

          Object.keys(nestedObj).forEach((relation) => this.addJoinedRelation(qb, { relation, nested: nestedObj[relation], parentAlias, parentMetadata, mode }));
        }
      });

      return;
    }

    const obj = spec as Record<string, unknown>;

    Object.keys(obj).forEach((relation) => this.addJoinedRelation(qb, { relation, nested: obj[relation], parentAlias, parentMetadata, mode }));
  }

  private addJoinedRelation(
    qb: SelectQueryBuilder<Entity>,
    { relation, nested, parentAlias, parentMetadata, mode }:
    {
      relation: string,
      nested: unknown,
      parentAlias: string,
      parentMetadata: EntityMetadata,
      mode: JoinMode,
    }
  ) {
    const relationMetadata = parentMetadata.findRelationWithPropertyPath(relation);

    if (!relationMetadata) {
      throw new CustomQueryBuilderError(`Relation "${relation}" not found on ${parentMetadata.name}`);
    }

    const newAlias = relationMetadata.propertyName;

    qb[mode](`${parentAlias}.${relation}`, newAlias);

    if (nested) {
      this.replayRelationSpec(qb, {
        spec: nested as RelationSpecArg,
        parentAlias: newAlias,
        parentMetadata: relationMetadata.inverseEntityMetadata,
        mode,
      });
    }
  }

  leftJoinsAndSelects<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<ApplyLeftJoinsAndSelects<Entity, Spec>, Projected, Repo> {
    return this.record({ kind: 'relationSpec', spec: spec as RelationSpecArg, mode: 'leftJoinAndSelect' });
  }

  joinsAndSelects<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<ApplyJoinsAndSelects<Entity, Spec>, Projected, Repo> {
    return this.record({ kind: 'relationSpec', spec: spec as RelationSpecArg, mode: 'innerJoinAndSelect' });
  }

  joins<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'relationSpec', spec: spec as RelationSpecArg, mode: 'innerJoin' });
  }

  leftJoins<const Spec extends JoinSpec<Entity>>(spec: Spec): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'relationSpec', spec: spec as RelationSpecArg, mode: 'leftJoin' });
  }

  private replayOrderBy(
    qb: SelectQueryBuilder<Entity>,
    state: MaterializeState,
    sort: string | Record<string, 'ASC' | 'DESC'>,
    orderOrParameters?: 'ASC' | 'DESC' | ObjectLiteral,
  ) {
    if (typeof sort === 'string' && typeof orderOrParameters === 'string') {
      qb.addOrderBy(sort, orderOrParameters);
    } else if (typeof sort === 'string' && typeof orderOrParameters === 'object') {
      const match = sort.match(/\s+(ASC|DESC)\s*$/i);
      const finalSort = match ? sort.slice(0, match.index) : sort;
      const order = match ? (match[1].toUpperCase() as 'ASC' | 'DESC') : undefined;
      const { newCondition, newParameters } = this.rewriteParameters(state, finalSort, orderOrParameters);

      qb.setParameters(newParameters);
      qb.addOrderBy(newCondition, order);
    } else if (typeof sort === 'string') {
      qb.addOrderBy(sort);
    } else {
      Object.keys(sort).forEach((key) => {
        // TypeORM's take + *-to-many pagination forces us to pass it without quoting.
        qb.addOrderBy(`${this.alias}.${key}`, (sort as Record<string, 'ASC' | 'DESC'>)[key]);
      });
    }
  }

  orderBy(sort: string, order?: 'ASC' | 'DESC'): QueryBuilder<Entity, Projected, Repo>;
  orderBy(sort: string, parameters: ObjectLiteral): QueryBuilder<Entity, Projected, Repo>;
  orderBy(sort: { [Key in keyof Entity]?: 'ASC' | 'DESC' }): QueryBuilder<Entity, Projected, Repo>;
  orderBy(
    sort: string | { [Key in keyof Entity]?: 'ASC' | 'DESC' },
    orderOrParameters?: 'ASC' | 'DESC' | ObjectLiteral,
  ): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'orderBy', sort: sort as string | Record<string, 'ASC' | 'DESC'>, orderOrParameters });
  }

  groupBy(group: string): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'groupBy', group });
  }

  skip(count: number): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'skip', count });
  }

  take(count: number): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'take', count });
  }

  limit(count: number): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'limit', count });
  }

  private replaySelect(qb: SelectQueryBuilder<Entity>, state: MaterializeState, selection: string[]) {
    if (state.selects.length > 0) {
      qb.addSelect(selection);
    } else {
      qb.select(selection);
    }

    state.selects.push(...selection);
  }

  private replaySubSelect(qb: SelectQueryBuilder<Entity>, state: MaterializeState, subquery: CustomQueryBuilderImpl<ObjectLiteral, boolean>, alias: string) {
    const rawSubQb = subquery.getRawQueryBuilder();
    const { newCondition, newParameters } = this.rewriteParameters(state, rawSubQb.getQuery(), rawSubQb.getParameters());

    if (state.selects.length > 0) {
      qb.addSelect(`(${newCondition})`, alias);
    } else {
      qb.select(`(${newCondition})`, alias);
    }

    qb.setParameters(newParameters);

    state.selects.push(alias);
  }

  select(selection: string): QueryBuilder<Entity, true, Repo>;
  select(selection: string[]): QueryBuilder<Entity, true, Repo>;
  select(subquery: AnyQueryBuilder, alias: string): QueryBuilder<Entity, true, Repo>;
  select(selectionOrSubquery: string | string[] | AnyQueryBuilder, alias?: string): QueryBuilder<Entity, true, Repo> {
    if (Array.isArray(selectionOrSubquery)) return this.record({ kind: 'select', selection: selectionOrSubquery });
    if (typeof selectionOrSubquery === 'string') return this.record({ kind: 'select', selection: [selectionOrSubquery] });

    if (!alias) throw new CustomQueryBuilderError('Alias must be provided when selecting a subquery');

    return this.record({ kind: 'subSelect', subquery: selectionOrSubquery as unknown as CustomQueryBuilderImpl<ObjectLiteral, boolean>, alias });
  }

  getOne() {
    if (this.hasSelect()) throw new CustomQueryBuilderError('getOne cannot be used after select');

    return this.materialize().qb.getOne();
  }

  getOneOrFail() {
    if (this.hasSelect()) throw new CustomQueryBuilderError('getOneOrFail cannot be used after select');

    return this.materialize().qb.getOneOrFail();
  }

  getMany() {
    if (this.hasSelect()) throw new CustomQueryBuilderError('getMany cannot be used after select');

    return this.materialize().qb.getMany();
  }

  getCount() {
    return this.materialize().qb.getCount();
  }

  getManyAndCount() {
    return this.materialize().qb.getManyAndCount();
  }

  forEach(options: { batchSize?: number } = {}): AsyncIterable<Entity, void, undefined> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<Entity, void, undefined> => this.iterateBatches(options),
    };
  }

  private async *iterateBatches(options: { batchSize?: number }): AsyncGenerator<Entity, void, undefined> {
    if (this.hasSelect()) throw new CustomQueryBuilderError('forEach cannot be used after select');

    const batchSize = options.batchSize ?? 1000;
    const primaryColumns = this.repository.metadata.primaryColumns;

    if (primaryColumns.length === 0) {
      throw new CustomQueryBuilderError(`Cannot iterate ${this.repository.metadata.name}: no primary key`);
    }

    const columnList = primaryColumns.map((col) => `${this.alias}.${col.propertyName}`).join(', ');
    let cursor: unknown[] | undefined;

    while (true) {
      const { qb, state } = this.materialize();

      qb.skip().take().limit(); // Remove any prior skip/take/limit

      // First call replaces any prior limit and orderBy; subsequent calls append.
      qb.orderBy(`${this.alias}.${primaryColumns[0].propertyName}`, 'ASC');
      primaryColumns.slice(1).forEach((col) => qb.addOrderBy(`${this.alias}.${col.propertyName}`, 'ASC'));

      if (cursor) {
        const placeholders = primaryColumns.map((col) => `:_pk_${col.propertyName}`).join(', ');
        const parameters: ObjectLiteral = {};

        primaryColumns.forEach((col, index) => { parameters[`_pk_${col.propertyName}`] = cursor![index]; });

        const { newCondition, newParameters } = this.rewriteParameters(state, `(${columnList}) > (${placeholders})`, parameters);

        qb.andWhere(`(${newCondition})`, newParameters);
      }

      qb.take(batchSize);

      const rows = await qb.getMany();

      for (const row of rows) yield row;

      if (rows.length < batchSize) return;

      const last = rows[rows.length - 1] as ObjectLiteral;

      cursor = primaryColumns.map((col) => last[col.propertyName]);
    }
  }

  private replaySetLock(qb: SelectQueryBuilder<Entity>, lockMode: LockMode, lockVersion?: number | Date) {
    if (lockMode === 'optimistic') {
      qb.setLock(lockMode, lockVersion as number | Date);
    } else {
      qb.setLock(lockMode);
    }
  }

  setLock(lockMode: LockMode, lockVersion?: number | Date): QueryBuilder<Entity, Projected, Repo> {
    if (lockMode === 'optimistic' && lockVersion === undefined) {
      throw new Error('Lock version must be provided for optimistic locking');
    }

    return this.record({ kind: 'setLock', lockMode, lockVersion });
  }

  delete() {
    return this.materialize().qb.delete().execute();
  }

  update(updates: { [Key in keyof Entity]?: Entity[Key] | (() => string) }, parameters?: ObjectLiteral) {
    const { qb, state } = this.materialize();
    const updateQb = qb.update();

    const parameterNameMap = Object.keys(parameters || {}).reduce((acc, cur) => {
      acc[cur] = this.incrementParameter(state);
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

  distinct(distinct: boolean = true): QueryBuilder<Entity, Projected, Repo> {
    return this.record({ kind: 'distinct', distinct });
  }

  getSql() {
    return this.materialize().qb.getSql();
  }

  getExists() {
    return this.materialize().qb.getExists();
  }

  async getExistsNot() {
    return !(await this.materialize().qb.getExists());
  }

  getRawOne() {
    return this.materialize().qb.getRawOne();
  }

  getRawMany() {
    return this.materialize().qb.getRawMany();
  }
}

/**
 * A CustomQueryBuilder instance. In addition to the query-building methods, every method of
 * the repository passed to the constructor is available on the instance (the builder's own
 * `update`/`delete` take precedence over the repository's). A repository method that returns
 * a CustomQueryBuilder continues the current chain: its recorded operations are merged onto
 * the builder it was called on, and its relation typing is intersected with the chain's.
 */
export type CustomQueryBuilder<
  Entity extends ObjectLiteral,
  Projected extends boolean = false,
  Repo extends Repository<ObjectLiteral> = Repository<Entity>,
> = QueryBuilder<Entity, Projected, Repo>;

interface CustomQueryBuilderConstructor {
  new <
    Entity extends ObjectLiteral,
    Projected extends boolean = false,
    Repo extends Repository<ObjectLiteral> = Repository<Entity>,
  >(repository: Repo & Repository<Entity>, alias: string): CustomQueryBuilder<Entity, Projected, Repo>;
}

export const CustomQueryBuilder = CustomQueryBuilderImpl as unknown as CustomQueryBuilderConstructor;
