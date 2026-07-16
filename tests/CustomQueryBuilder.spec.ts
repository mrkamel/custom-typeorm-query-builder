import { describe, expect, it } from 'vitest';
import { defineQueryBuilder } from '../src/CustomQueryBuilder';
import { UserRepository } from './repositories/UserRepository';
import { ProfileRepository } from './repositories/ProfileRepository';
import { PostRepository } from './repositories/PostRepository';
import { CodeRepository } from './repositories/CodeRepository';
import { Code } from './entities/CodeEntity';
import { MembershipRepository } from './repositories/MembershipRepository';
import { dataSource } from './dataSource';
import { randomUUID } from 'crypto';

const isSqlite = dataSource.options.type === 'better-sqlite3';

async function createUser({ name = 'Name', age = null }: { name?: string, age?: number | null } = {}) {
  return await UserRepository.save({ name, age });
}

async function createProfile({ bio = 'Bio', user_id }: { bio?: string, user_id: string }) {
  return await ProfileRepository.save({ bio, user_id });
}

async function createPost({ title = 'Title', published = false, user_id }: { title?: string, published?: boolean, user_id: string }) {
  return await PostRepository.save({ title, published, user_id });
}

describe('CustomQueryBuilder', () => {
  describe('all', () => {
    it('returns every row clause', async () => {
      const alice = await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });

      const query = UserRepository.qb().all();
      const result = await query.getMany();

      expect(result.map((user) => user.id).sort()).toEqual([alice.id, bob.id].sort());
    });
  });

  describe('none', () => {
    it('returns no rows', async () => {
      await createUser();
      await createUser();

      const result = await UserRepository.qb().none().getMany();

      expect(result).toEqual([]);
    });
  });

  describe('where', () => {
    it('matches by object equality', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser();

      const result = await UserRepository.qb().where({ name: 'alice' }).getOne();

      expect(result?.id).toBe(alice.id);
    });

    it('handles IS NULL for null values in an object condition', async () => {
      const noAge = await createUser({ age: null });
      await createUser({ age: 25 });

      const result = await UserRepository.qb().where({ age: null }).getMany();

      expect(result.map((user) => user.id)).toEqual([noAge.id]);
    });

    it('emits IN (...) for an array value', async () => {
      const alice = await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });
      await createUser({ name: 'other' });

      const result = await UserRepository.qb()
        .where({ name: ['alice', 'bob'] })
        .getMany();

      expect(result.map((user) => user.id).sort()).toEqual([alice.id, bob.id].sort());
    });

    it('emits a constant false for an empty array (matches no rows)', async () => {
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      const sql = UserRepository.qb().where({ name: [] }).getSql();
      expect(sql).toMatch(/1 = 0/);

      const result = await UserRepository.qb().where({ name: [] }).getMany();
      expect(result).toEqual([]);
    });

    it('combines multiple object keys with AND', async () => {
      await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'alice', age: 40 });
      const target = await createUser({ name: 'alice', age: 25 });

      const result = await UserRepository.qb().where({ name: 'alice', age: 25 }).getOne();

      expect(result?.id).toBe(target.id);
    });

    it('wraps raw SQL conditions in parentheses to preserve precedence', async () => {
      const alice = await createUser({ name: 'alice', age: 30 });
      const bob = await createUser({ name: 'bob' });
      await createUser({ name: 'other' });

      const sql = UserRepository.qb()
        .where('users.name = :a OR users.name = :b', { a: 'alice', b: 'bob' })
        .where({ age: 30 })
        .getSql();

      expect(sql).toMatch(/\(.*OR.*\).*AND/i);

      const result = await UserRepository.qb()
        .where('users.name = :a OR users.name = :b', { a: 'alice', b: 'bob' })
        .where({ age: 30 })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
      expect(result.map((user) => user.id)).not.toContain(bob.id);
    });

    it('rewrites named parameters so reused names do not collide', async () => {
      const alice = await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'bob', age: 40 });

      const result = await UserRepository.qb()
        .where('users.name = :value', { value: 'alice' })
        .where('users.age = :value', { value: 30 })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });

    it('does not rewrite parameters inside postgres :: casts', () => {
      const sql = UserRepository.qb()
        .where('users.age::int = :int', { int: 30 })
        .getSql();

      expect(sql).toMatch(/age::int/);
    });

    it('rewrites array spread parameters in raw SQL IN (:...names) clauses', async () => {
      const alice = await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });
      await createUser({ name: 'carol' });

      const result = await UserRepository.qb()
        .where('users.name IN (:...names)', { names: ['alice', 'bob'] })
        .where('users.name IN (:...names)', { names: ['alice', 'bob', 'carol'] })
        .getMany();

      expect(result.map((user) => user.id).sort()).toEqual([alice.id, bob.id].sort());
    });

    it('respects word boundaries so a parameter name is not a prefix of another', async () => {
      const alice = await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'bob', age: 40 });

      const result = await UserRepository.qb()
        .where('users.name = :a AND users.age = :age', { a: 'alice', age: 30 })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });

    it('returns a new instance without mutating the original', async () => {
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      const base = UserRepository.qb();
      const filtered = base.where({ name: 'alice' });

      const baseResult = await base.getMany();
      const filteredResult = await filtered.getMany();

      expect(baseResult).toHaveLength(2);
      expect(filteredResult).toHaveLength(1);
    });

    it('isolates branched builders with mixed join / select / where chains', async () => {
      const alice = await createUser({ name: 'alice', age: 30 });
      const bob = await createUser({ name: 'bob', age: 40 });
      await createProfile({ user_id: alice.id });

      const base = UserRepository.qb()
        .leftJoin<['profile']>('users.profile', 'profile')
        .where('users.age >= :min', { min: 20 });

      const onlyAlice = base.where({ name: 'alice' });
      const onlyWithProfile = base.where('profile.bio IS NOT NULL');
      const projected = base.select('users.name');

      const aliceResult = await onlyAlice.getMany();
      const profileResult = await onlyWithProfile.getMany();
      const baseResult = await base.getMany();
      const projectedRows = await projected.getRawMany();

      expect(aliceResult.map((user) => user.id)).toEqual([alice.id]);
      expect(profileResult.map((user) => user.id)).toEqual([alice.id]);
      expect(baseResult.map((user) => user.id).sort()).toEqual([alice.id, bob.id].sort());
      expect(projectedRows.map((row) => row.users_name).sort()).toEqual(['alice', 'bob']);
    });

    it('matches a transformer-wrapped (non-scalar non-array) column by scalar value', async () => {
      await CodeRepository.save({ code: new Code('alpha') });
      await CodeRepository.save({ code: new Code('beta') });

      const result = await CodeRepository.qb().where({ code: 'alpha' }).getOne();

      expect(result?.code).toBeInstanceOf(Code);
      expect(result?.code.value).toBe('alpha');
    });

    it('matches a transformer-wrapped column with an IN array of scalar values', async () => {
      await CodeRepository.save({ code: new Code('alpha') });
      await CodeRepository.save({ code: new Code('beta') });
      await CodeRepository.save({ code: new Code('gamma') });

      const result = await CodeRepository.qb()
        .where({ code: ['alpha', 'beta'] })
        .getMany();

      expect(result.map((row) => row.code.value).sort()).toEqual(['alpha', 'beta']);
    });
  });

  describe('object form column restrictions', () => {
    it('rejects array-typed columns at the type level', () => {

      const _typeOnly = () => {
        // @ts-expect-error posts is a *-to-many relation (array type) — ambiguous, force raw SQL
        UserRepository.qb().where({ posts: [] });

        // @ts-expect-error same for whereNot
        UserRepository.qb().whereNot({ posts: [] });

        // sanity: scalar columns and arrays of scalars stay allowed
        UserRepository.qb().where({ name: 'alice' });
        UserRepository.qb().where({ name: ['alice', 'bob'] });
        UserRepository.qb().where({ age: null });
      };
    });
  });

  describe('whereNot', () => {
    it('excludes by object equality', async () => {
      await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });

      const result = await UserRepository.qb().whereNot({ name: 'alice' }).getMany();

      expect(result.map((user) => user.id)).toEqual([bob.id]);
    });

    it('handles IS NOT NULL for null values in an object condition', async () => {
      await createUser({ age: null });
      const withAge = await createUser({ age: 25 });

      const result = await UserRepository.qb().whereNot({ age: null }).getMany();

      expect(result.map((user) => user.id)).toEqual([withAge.id]);
    });

    it('emits NOT IN (...) for an array value', async () => {
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      const carol = await createUser({ name: 'carol' });

      const result = await UserRepository.qb()
        .whereNot({ name: ['alice', 'bob'] })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([carol.id]);
    });

    it('emits a constant true for an empty exclusion (matches all rows)', async () => {
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      const sql = UserRepository.qb().whereNot({ name: [] }).getSql();
      expect(sql).toMatch(/1 = 1/);

      const result = await UserRepository.qb().whereNot({ name: [] }).getMany();
      expect(result).toHaveLength(2);
    });

    it('negates a raw SQL condition', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      const result = await UserRepository.qb()
        .whereNot('users.name = :name', { name: 'bob' })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });

    it('excludes a transformer-wrapped (non-scalar non-array) column by scalar value', async () => {
      await CodeRepository.save({ code: new Code('alpha') });
      const beta = await CodeRepository.save({ code: new Code('beta') });

      const result = await CodeRepository.qb().whereNot({ code: 'alpha' }).getMany();

      expect(result.map((row) => row.id)).toEqual([beta.id]);
    });

    it('excludes a transformer-wrapped column with a NOT IN array of scalars', async () => {
      await CodeRepository.save({ code: new Code('alpha') });
      await CodeRepository.save({ code: new Code('beta') });
      const gamma = await CodeRepository.save({ code: new Code('gamma') });

      const result = await CodeRepository.qb()
        .whereNot({ code: ['alpha', 'beta'] })
        .getMany();

      expect(result.map((row) => row.id)).toEqual([gamma.id]);
    });
  });

  describe('leftJoinAndSelect', () => {
    it('joins and hydrates the related entity', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoinAndSelect<['profile']>('users.profile', 'profile')
        .where({ id: alice.id })
        .getOne();

      expect(result?.profile?.bio).toBe('bio');
    });
  });

  describe('leftJoinsAndSelects', () => {
    it('joins and selects a single to-one relation', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoinsAndSelects(['profile'])
        .where({ id: alice.id })
        .getOne();

      expect(result?.profile?.bio).toBe('bio');
    });

    it('accepts an array of relation names', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      await createPost({ title: 'title', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoinsAndSelects(['profile', 'posts'])
        .where({ id: alice.id })
        .getOne();

      expect(result?.profile?.bio).toBe('bio');
      expect(result?.posts.map((post) => post.title)).toEqual(['title']);
    });

    it('accepts an array as the value of an object entry', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      await createPost({ user_id: alice.id });

      const result = await PostRepository.qb()
        .leftJoinsAndSelects({ user: ['profile'] })
        .getOne();

      expect(result?.user?.id).toBe(alice.id);
      expect(result?.user?.profile?.bio).toBe('bio');
    });

    it('mixes string entries and nested-spec objects in the same array', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      await createPost({ title: 'title', user_id: alice.id });

      const result = await UserRepository.qb('parent_users')
        .leftJoinsAndSelects(['profile', { posts: ['user'] }])
        .where({ id: alice.id })
        .getOne();

      expect(result?.profile?.bio).toBe('bio');
      expect(result?.posts.map((post) => post.title)).toEqual(['title']);
      expect(result?.posts[0].user?.id).toBe(alice.id);
    });

    it('joins and selects multiple relations at once', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      await createPost({ title: 'one', user_id: alice.id });
      await createPost({ title: 'two', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoinsAndSelects(['profile', 'posts'])
        .where({ id: alice.id })
        .getOne();

      expect(result?.profile?.bio).toBe('bio');
      expect(result?.posts.map((post) => post.title).sort()).toEqual(['one', 'two']);
    });

    it('joins and selects nested relations using target table names as aliases', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      await createPost({ user_id: alice.id });

      const result = await PostRepository.qb()
        .leftJoinsAndSelects({ user: ['profile'] })
        .getOne();

      expect(result?.user?.id).toBe(alice.id);
      expect(result?.user?.profile?.bio).toBe('bio');
    });

    it('uses LEFT JOIN and keeps rows without the relation', async () => {
      const alice = await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });
      await createProfile({ bio: 'bio', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoinsAndSelects(['profile'])
        .orderBy({ name: 'ASC' })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id, bob.id]);
      expect(result[0].profile?.bio).toBe('bio');
      expect(result[1].profile).toBeNull();
    });

    it('exposes the join alias for use in where clauses', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createProfile({ bio: 'bio', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoinsAndSelects(['profile'])
        .where('profile.bio = :bio', { bio: 'bio' })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });

    it('rejects unknown relations at the type level', () => {

      const _typeOnly = () => {
        // @ts-expect-error nonexistent is not a relation on UserEntity
        UserRepository.qb().leftJoinsAndSelects(['nonexistent']);

        // @ts-expect-error name is a scalar column, not a relation
        UserRepository.qb().leftJoinsAndSelects(['name']);

        UserRepository.qb().leftJoinsAndSelects({
          // @ts-expect-error title is a scalar, not a relation on PostEntity
          posts: ['title'],
        });

        UserRepository.qb().leftJoinsAndSelects({
          posts: {
            // @ts-expect-error nonexistent is not a relation on PostEntity (nested, over the User <-> Post cycle)
            user: { nonexistent: [] },
          },
        });
      };
    });
  });

  describe('joinsAndSelects', () => {
    it('inner-joins a single relation and hydrates it', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createProfile({ bio: 'bio', user_id: alice.id });

      const result = await UserRepository.qb()
        .joinsAndSelects(['profile'])
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
      expect(result[0].profile.bio).toBe('bio');
    });

    it('filters out rows without the relation', async () => {
      const alice = await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });
      await createProfile({ user_id: alice.id });

      const result = await UserRepository.qb()
        .joinsAndSelects(['profile'])
        .orderBy({ name: 'ASC' })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
      expect(result.map((user) => user.id)).not.toContain(bob.id);
    });

    it('hydrates nested relations using target table names as aliases', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      await createPost({ title: 'one', user_id: alice.id });

      const bob = await createUser({ name: 'bob' });
      await createPost({ user_id: bob.id });

      const result = await PostRepository.qb()
        .joinsAndSelects({ user: ['profile'] })
        .getMany();

      expect(result.map((post) => post.title)).toEqual(['one']);
      expect(result[0].user.profile.bio).toBe('bio');
    });

    it('exposes the join alias for use in where clauses', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      const carol = await createUser({ name: 'carol' });
      await createProfile({ bio: 'other', user_id: carol.id });
      const _bob = await createUser({ name: 'bob' });

      const result = await UserRepository.qb()
        .joinsAndSelects(['profile'])
        .where('profile.bio = :bio', { bio: 'bio' })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });

    it('rejects unknown relations at the type level', () => {

      const _typeOnly = () => {
        // @ts-expect-error nonexistent is not a relation on UserEntity
        UserRepository.qb().joinsAndSelects(['nonexistent']);

        // @ts-expect-error name is a scalar column, not a relation
        UserRepository.qb().joinsAndSelects(['name']);

        UserRepository.qb().joinsAndSelects({
          // @ts-expect-error title is a scalar, not a relation on PostEntity
          posts: ['title'],
        });
      };
    });
  });

  describe('joins', () => {
    it('inner-joins a single relation without hydrating it', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createProfile({ user_id: alice.id });

      const result = await UserRepository.qb()
        .joins(['profile'])
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
      expect(result[0].profile).toBeUndefined();
    });

    it('exposes the table-name alias for use in where clauses', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      const carol = await createUser({ name: 'carol' });
      await createProfile({ bio: 'other', user_id: carol.id });
      const _bob = await createUser({ name: 'bob' });

      const result = await UserRepository.qb()
        .joins(['profile'])
        .where('profile.bio = :bio', { bio: 'bio' })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });

    it('joins nested relations using target table names as aliases', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ user_id: alice.id });
      await createPost({ title: 'one', user_id: alice.id });

      const bob = await createUser({ name: 'bob' });
      await createPost({ user_id: bob.id });

      const result = await PostRepository.qb()
        .joins({ user: ['profile'] })
        .getMany();

      expect(result.map((post) => post.title)).toEqual(['one']);
    });

    it('rejects unknown relations at the type level', () => {

      const _typeOnly = () => {
        // @ts-expect-error nonexistent is not a relation on UserEntity
        UserRepository.qb().joins(['nonexistent']);

        // @ts-expect-error name is a scalar column, not a relation
        UserRepository.qb().joins(['name']);
      };
    });
  });

  describe('leftJoins', () => {
    it('left-joins relations without hydrating and keeps rows without a match', async () => {
      const alice = await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });
      await createProfile({ user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoins(['profile'])
        .orderBy({ name: 'ASC' })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id, bob.id]);
      expect(result[0].profile).toBeUndefined();
      expect(result[1].profile).toBeUndefined();
    });

    it('exposes the table-name alias for use in where clauses', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createProfile({ user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoins(['profile'])
        .where('profile.bio IS NOT NULL')
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });

    it('accepts nested specs', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });
      await createPost({ title: 'title', user_id: alice.id });

      const result = await PostRepository.qb()
        .leftJoins({ user: ['profile'] })
        .where('profile.bio = :bio', { bio: 'bio' })
        .getMany();

      expect(result.map((post) => post.title)).toEqual(['title']);
    });

    it('rejects unknown relations at the type level', () => {

      const _typeOnly = () => {
        // @ts-expect-error nonexistent is not a relation on UserEntity
        UserRepository.qb().leftJoins(['nonexistent']);
      };
    });
  });

  describe('leftJoin', () => {
    it('joins without selecting the related entity', async () => {
      const alice = await createUser({ name: 'alice' });
      await createProfile({ bio: 'bio', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoin<['profile']>('users.profile', 'profile')
        .where('profile.bio = :bio', { bio: 'bio' })
        .getOne();

      expect(result?.id).toBe(alice.id);
      expect(result?.profile).toBeUndefined();
    });
  });

  describe('innerJoinAndSelect', () => {
    it('only returns rows that have a matching relation', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createProfile({ bio: 'bio', user_id: alice.id });

      const result = await UserRepository.qb()
        .innerJoinAndSelect<['profile']>('users.profile', 'profile')
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
      expect(result[0].profile?.bio).toBe('bio');
    });
  });

  describe('innerJoin', () => {
    it('filters to rows with a matching relation without hydrating it', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createProfile({ user_id: alice.id });

      const result = await UserRepository.qb()
        .innerJoin<['profile']>('users.profile', 'profile')
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
      expect(result[0].profile).toBeUndefined();
    });
  });

  describe('orderBy', () => {
    it('orders by an object map of column to direction', async () => {
      await createUser({ name: 'carol' });
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      const result = await UserRepository.qb().orderBy({ name: 'ASC' }).getMany();

      expect(result.map((user) => user.name)).toEqual(['alice', 'bob', 'carol']);
    });

    it('orders by a raw column expression with explicit direction', async () => {
      await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'bob', age: 40 });
      await createUser({ name: 'carol', age: 50 });

      const result = await UserRepository.qb().orderBy('users.age', 'DESC').getMany();

      expect(result.map((user) => user.name)).toEqual(['carol', 'bob', 'alice']);
    });

    it('accepts parameters with direction embedded in the sort', async () => {
      const alice = await createUser({ name: 'alice', age: 30 });
      const bob = await createUser({ name: 'bob', age: 40 });
      await createUser({ name: 'carol', age: 50 });

      const result = await UserRepository.qb()
        .orderBy('ABS(users.age - :target) ASC', { target: 42 })
        .getMany();

      expect(result.map((user) => user.name)).toEqual(['bob', 'carol', 'alice']);
      expect(result[0].id).toBe(bob.id);
      expect(result[2].id).toBe(alice.id);
    });

    it('rewrites parameter names to avoid collision with a chained where', async () => {
      await createUser({ name: 'alice', age: 30 });
      const bob = await createUser({ name: 'bob', age: 43 });
      const carol = await createUser({ name: 'carol', age: 50 });

      const result = await UserRepository.qb()
        .where('users.age >= :value', { value: 40 })
        .orderBy('ABS(users.age - :value) ASC', { value: 45 })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([bob.id, carol.id]);
    });

    it('does not emit a trailing default ASC after an embedded DESC', async () => {
      await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'bob', age: 40 });

      const sql = UserRepository.qb().orderBy('ABS(users.age - :target) DESC', { target: 45 }).getSql();
      expect(sql).not.toMatch(/DESC\s+ASC/);

      const result = await UserRepository.qb().orderBy('ABS(users.age - :target) DESC', { target: 45 }).getMany();
      expect(result.map((user) => user.name)).toEqual(['alice', 'bob']);
    });

    it('survives the distinctAlias pagination path (take + *-to-many join load)', async () => {
      const alice = await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });
      await createPost({ title: 'a1', user_id: alice.id });
      await createPost({ title: 'a2', user_id: alice.id });
      await createPost({ user_id: bob.id });

      const result = await UserRepository.qb()
        .leftJoinsAndSelects(['posts'])
        .orderBy({ name: 'ASC' })
        .take(1)
        .getMany();

      expect(result.map((user) => user.name)).toEqual(['alice']);
      expect(result[0].posts.map((post) => post.title).sort()).toEqual(['a1', 'a2']);
    });
  });

  describe('groupBy', () => {
    it('groups raw rows by a column', async () => {
      await createUser({ name: 'alice' });
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      const rows = await UserRepository.qb()
        .select(['users.name AS name', 'COUNT(*) AS count'])
        .groupBy('users.name')
        .orderBy('name', 'ASC')
        .getRawMany();

      expect(rows.map((row) => ({ name: row.name, count: Number(row.count) }))).toEqual([
        { name: 'alice', count: 2 },
        { name: 'bob', count: 1 },
      ]);
    });
  });

  describe('skip / take / limit', () => {
    it('paginates results with skip and take', async () => {
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createUser({ name: 'carol' });

      const page = await UserRepository.qb()
        .orderBy({ name: 'ASC' })
        .skip(1)
        .take(1)
        .getMany();

      expect(page.map((user) => user.name)).toEqual(['bob']);
    });

    it('applies a SQL LIMIT', async () => {
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      const sql = UserRepository.qb().limit(1).getSql();
      expect(sql).toMatch(/LIMIT 1/i);

      const result = await UserRepository.qb().orderBy({ name: 'ASC' }).limit(1).getMany();
      expect(result).toHaveLength(1);
    });
  });

  describe('select', () => {
    it('returns raw rows and forbids getOne after select at the type level', async () => {
      await createUser({ name: 'alice' });

      const projected = UserRepository.qb().select('users.name');

      // @ts-expect-error getOne is removed after select
      void projected.getOne;
      // @ts-expect-error getMany is removed after select
      void projected.getMany;
      // @ts-expect-error getOneOrFail is removed after select
      void projected.getOneOrFail;

      const rows = await projected.getRawMany();

      expect(rows).toEqual([{ users_name: 'alice' }]);
    });

    it('throws at runtime if entity getters are reached after select', async () => {
      await createUser({ name: 'alice' });

      const projected = UserRepository.qb().select('users.name');
      const escapeHatch = projected as unknown as { getOne(): Promise<unknown>, getMany(): Promise<unknown>, getOneOrFail(): Promise<unknown> };

      expect(() => escapeHatch.getOne()).toThrow(/getOne cannot be used after select/);
      expect(() => escapeHatch.getMany()).toThrow(/getMany cannot be used after select/);
      expect(() => escapeHatch.getOneOrFail()).toThrow(/getOneOrFail cannot be used after select/);
    });

    it('appends to a running selection list when called twice', async () => {
      await createUser({ name: 'alice', age: 30 });

      const rows = await UserRepository.qb()
        .select('users.name')
        .select('users.age')
        .getRawMany();

      expect(rows).toEqual([{ users_name: 'alice', users_age: 30 }]);
    });

    it('embeds a scalar subquery as an aliased column when called with (subquery, alias)', async () => {
      await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'bob', age: 40 });
      await createUser({ name: 'carol', age: 50 });

      const rows = await UserRepository.qb()
        .select(UserRepository.qb().select('COUNT(*)').where('users.age >= :min', { min: 40 }), 'oldCount')
        .orderBy('users.name', 'ASC')
        .getRawMany();

      expect(rows.map((row) => Number(row.oldCount))).toEqual([2, 2, 2]);
    });

    it('does not collide subquery parameter names with the outer query', async () => {
      await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'bob', age: 40 });
      const carol = await createUser({ name: 'carol', age: 50 });

      const rows = await UserRepository.qb()
        .where('users.age >= :min', { min: 50 })
        .select('users.id')
        .select(UserRepository.qb().select('COUNT(*)').where('users.age >= :min', { min: 40 }), 'oldCount')
        .getRawMany();

      expect(rows).toHaveLength(1);
      expect(rows[0].users_id).toBe(carol.id);
      expect(Number(rows[0].oldCount)).toBe(2);
    });

    it('embeds a correlated subquery over a different entity', async () => {
      const alice = await createUser({ name: 'alice' });
      const bob = await createUser({ name: 'bob' });

      await createPost({ user_id: alice.id });
      await createPost({ user_id: alice.id });
      await createPost({ user_id: bob.id });

      const rows = await UserRepository.qb()
        .select('users.name')
        .select(PostRepository.qb().select('COUNT(*)').where('posts.user_id = users.id'), 'postCount')
        .orderBy('users.name', 'ASC')
        .getRawMany();

      expect(rows.map((row) => Number(row.postCount))).toEqual([2, 1]);
    });

    it('throws when called with a subquery but no alias', () => {
      const subquery = UserRepository.qb().select('COUNT(*)');

      // @ts-expect-error alias is required when first argument is a subquery
      expect(() => UserRepository.qb().select(subquery)).toThrow(/Alias must be provided/);
    });

    it('accepts a single string selection', async () => {
      await createUser({ name: 'alice' });

      const projected = UserRepository.qb().select('users.name');

      // @ts-expect-error getOne is removed after select
      void projected.getOne;

      const rows = await projected.getRawMany();

      expect(rows).toEqual([{ users_name: 'alice' }]);
    });

    it('appends a single string selection to a prior select call', async () => {
      await createUser({ name: 'alice', age: 30 });

      const rows = await UserRepository.qb()
        .select('users.name')
        .select('users.age')
        .getRawMany();

      expect(rows).toEqual([{ users_name: 'alice', users_age: 30 }]);
    });

    it('replaces the default entity selection when a subquery is the first select', async () => {
      await createUser({ name: 'alice' });

      const projected = UserRepository.qb()
        .select(UserRepository.qb().select('COUNT(*)').where('users.age >= :min', { min: 40 }), 'oldCount');

      const sql = projected.getSql();

      expect(sql).not.toMatch(/users\./);

      const rows = await projected.getRawMany();

      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0])).toEqual(['oldCount']);
    });

    it('appends a subquery alongside a prior explicit selection', async () => {
      await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'bob', age: 40 });

      const rows = await UserRepository.qb()
        .select('users.name')
        .select(UserRepository.qb().select('COUNT(*)').where('users.age >= :min', { min: 40 }), 'oldCount')
        .orderBy('users.name', 'ASC')
        .getRawMany();

      expect(rows.map((row) => row.users_name)).toEqual(['alice', 'bob']);
      expect(rows.map((row) => Number(row.oldCount))).toEqual([1, 1]);
    });
  });

  describe('getOneOrFail', () => {
    it('rejects when no row matches', async () => {
      await expect(UserRepository.qb().where({ name: 'missing' }).getOneOrFail()).rejects.toThrow();
    });

    it('returns the row when one matches', async () => {
      const alice = await createUser({ name: 'alice' });

      const result = await UserRepository.qb().where({ id: alice.id }).getOneOrFail();

      expect(result.id).toBe(alice.id);
    });
  });

  describe('getRawQueryBuilder', () => {
    it('returns a cloned TypeORM query builder with the accumulated state', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      const custom = UserRepository.qb().where({ name: 'alice' });
      const raw = custom.getRawQueryBuilder();

      const result = await raw.getMany();
      expect(result.map((user) => user.id)).toEqual([alice.id]);

      // Mutating the returned builder does not affect the wrapper.
      raw.andWhere('1 = 0');
      const untouched = await custom.getMany();
      expect(untouched.map((user) => user.id)).toEqual([alice.id]);
    });
  });

  describe('getCount', () => {
    it('returns the number of matching rows', async () => {
      await createUser({ name: 'alice', age: 30 });
      await createUser({ name: 'bob', age: 40 });
      await createUser({ name: 'carol', age: 50 });

      const count = await UserRepository.qb().where('users.age >= :min', { min: 40 }).getCount();

      expect(count).toBe(2);
    });
  });

  describe('getManyAndCount', () => {
    it('returns rows and total count honouring take', async () => {
      await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createUser({ name: 'carol' });

      const [rows, count] = await UserRepository.qb().orderBy({ name: 'ASC' }).take(2).getManyAndCount();

      expect(rows.map((user) => user.name)).toEqual(['alice', 'bob']);
      expect(count).toBe(3);
    });
  });

  describe('forEach', () => {
    it('yields every row across multiple batches', async () => {
      const users = [];

      for (let index = 0; index < 7; index += 1) users.push(await createUser({ name: `user${index}` }));

      const yielded: string[] = [];

      for await (const row of UserRepository.qb().forEach({ batchSize: 3 })) {
        yielded.push(row.id);
      }

      expect(yielded.sort()).toEqual(users.map((user) => user.id).sort());
    });

    it('respects an existing where filter', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });
      await createUser({ name: 'carol' });

      const yielded: string[] = [];
      for await (const row of UserRepository.qb().where({ name: 'alice' }).forEach({ batchSize: 10 })) {
        yielded.push(row.id);
      }

      expect(yielded).toEqual([alice.id]);
    });

    it('orders by primary key only, replacing any prior orderBy', async () => {
      const created = [];

      for (let index = 0; index < 5; index += 1) created.push(await createUser({ name: `u${index}`, age: 10 - index }));

      const yielded: string[] = [];

      for await (const row of UserRepository.qb().orderBy({ age: 'ASC' }).forEach({ batchSize: 2 })) {
        yielded.push(row.id);
      }

      expect(yielded).toEqual([...created].map((user) => user.id).sort());
    });

    it('iterates correctly with a composite primary key', async () => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();

      const rows = [
        { tenant_id: tenantA, user_id: randomUUID(), role: 'admin' },
        { tenant_id: tenantA, user_id: randomUUID(), role: 'member' },
        { tenant_id: tenantA, user_id: randomUUID(), role: 'viewer' },
        { tenant_id: tenantB, user_id: randomUUID(), role: 'admin' },
        { tenant_id: tenantB, user_id: randomUUID(), role: 'member' },
      ];

      for (const row of rows) await MembershipRepository.save(row);

      const yielded: { tenant_id: string, user_id: string }[] = [];

      for await (const row of MembershipRepository.qb().forEach({ batchSize: 2 })) {
        yielded.push({ tenant_id: row.tenant_id, user_id: row.user_id });
      }

      const expected = [...rows].sort((a, b) => {
        if (a.tenant_id !== b.tenant_id) return a.tenant_id < b.tenant_id ? -1 : 1;

        return a.user_id < b.user_id ? -1 : 1;
      });

      expect(yielded).toEqual(expected.map((row) => ({ tenant_id: row.tenant_id, user_id: row.user_id })));
    });

    it('ignores any prior skip/take/limit in the chain', async () => {
      const created = [];

      for (let index = 0; index < 5; index += 1) created.push(await createUser({ name: `user${index}` }));

      const yielded: string[] = [];

      for await (const row of UserRepository.qb().skip(2).take(1).limit(1).forEach({ batchSize: 2 })) {
        yielded.push(row.id);
      }

      expect(yielded.sort()).toEqual(created.map((user) => user.id).sort());
    });

    it('yields nothing for an empty result set', async () => {
      const yielded: string[] = [];

      for await (const row of UserRepository.qb().forEach()) yielded.push(row.id);

      expect(yielded).toEqual([]);
    });

    it('returns a re-iterable value that can be scanned more than once', async () => {
      const created = [];

      for (let index = 0; index < 5; index += 1) created.push(await createUser({ name: `user${index}` }));

      const iterable = UserRepository.qb().forEach({ batchSize: 2 });

      const first: string[] = [];
      for await (const row of iterable) first.push(row.id);

      const second: string[] = [];
      for await (const row of iterable) second.push(row.id);

      const expected = created.map((user) => user.id).sort();

      expect(first.sort()).toEqual(expected);
      expect(second.sort()).toEqual(expected);
    });

    it('throws after select (projection)', async () => {
      const projected = UserRepository.qb().select('users.name');

      // @ts-expect-error forEach is removed at the type level after select
      void projected.forEach;

      const escapeHatch = projected as unknown as { forEach: () => AsyncGenerator<unknown> };

      await expect((async () => {
        for await (const _row of escapeHatch.forEach()) { /* unreachable */ }
      })()).rejects.toThrow(/forEach cannot be used after select/);
    });
  });

  describe('getExists', () => {
    it('returns true if a matching row exists, false otherwise', async () => {
      await createUser({ name: 'alice' });

      await expect(UserRepository.qb().where({ name: 'alice' }).getExists()).resolves.toBe(true);
      await expect(UserRepository.qb().where({ name: 'missing' }).getExists()).resolves.toBe(false);
    });
  });

  describe('getExistsNot', () => {
    it('returns false if a matching row exists, true otherwise', async () => {
      await createUser({ name: 'alice' });

      await expect(UserRepository.qb().where({ name: 'alice' }).getExistsNot()).resolves.toBe(false);
      await expect(UserRepository.qb().where({ name: 'missing' }).getExistsNot()).resolves.toBe(true);
    });
  });

  describe('getRawOne', () => {
    it('returns a single raw row', async () => {
      await createUser({ name: 'alice' });

      const row = await UserRepository.qb().select('users.name').getRawOne();

      expect(row).toEqual({ users_name: 'alice' });
    });
  });

  describe('distinct', () => {
    it('emits a SELECT DISTINCT in the SQL', async () => {
      const sql = UserRepository.qb().distinct().getSql();
      expect(sql).toMatch(/SELECT\s+DISTINCT/i);
    });

    it('disables distinct when called with false', async () => {
      const sql = UserRepository.qb().distinct(false).getSql();
      expect(sql).not.toMatch(/SELECT\s+DISTINCT/i);
    });
  });

  describe('setLock', () => {
    it('appends FOR UPDATE for pessimistic_write', async () => {
      if (isSqlite) return;

      const sql = UserRepository.qb().setLock('pessimistic_write').getSql();
      expect(sql).toMatch(/FOR UPDATE/i);
    });

    it('throws if optimistic lock is requested without a version', () => {
      expect(() => UserRepository.qb().setLock('optimistic')).toThrow(/Lock version must be provided/);
    });
  });

  describe('delete', () => {
    it('removes matching rows', async () => {
      const alice = await createUser({ name: 'alice' });
      await createUser({ name: 'bob' });

      await UserRepository.qb().where({ id: alice.id }).delete();

      const remaining = await UserRepository.find();
      expect(remaining.map((user) => user.name)).toEqual(['bob']);
    });
  });

  describe('update', () => {
    it('applies a plain object update', async () => {
      const alice = await createUser({ name: 'alice' });

      await UserRepository.qb().where({ id: alice.id }).update({ age: 31 });

      const updated = await UserRepository.findOneByOrFail({ id: alice.id });
      expect(updated.age).toBe(31);
    });

    it('applies a raw SQL expression with parameters', async () => {
      const alice = await createUser({ name: 'alice', age: 30 });

      await UserRepository.qb()
        .where({ id: alice.id })
        .update({ age: () => 'age + :inc' }, { inc: 5 });

      const updated = await UserRepository.findOneByOrFail({ id: alice.id });
      expect(updated.age).toBe(35);
    });
  });

  describe('transaction context', () => {
    it('preserves the transaction when qb() runs on a transaction-scoped repository', async () => {
      await UserRepository.manager.transaction(async (manager) => {
        const alice = await manager.withRepository(UserRepository).save({ name: 'alice', age: 30 });
        const result = await manager.withRepository(UserRepository).qb().where({ id: alice.id }).getMany();

        expect(result.map((user) => user.id)).toEqual([alice.id]);
      });
    });
  });
});

describe('defineQueryBuilder', () => {
  it('runs a custom filter method', async () => {
    const alice = await createUser({ name: 'alice', age: 30 });
    await createUser({ name: 'bob', age: 10 });

    const result = await UserRepository.cqb().adults().getMany();

    expect(result.map((user) => user.id)).toEqual([alice.id]);
  });

  it('chains a custom method after a built-in', async () => {
    const alice = await createUser({ name: 'alice', age: 30 });
    await createUser({ name: 'alice', age: 10 });

    const result = await UserRepository.cqb().where({ name: 'alice' }).adults().getMany();

    expect(result.map((user) => user.id)).toEqual([alice.id]);
  });

  it('chains a built-in after a custom method', async () => {
    const alice = await createUser({ name: 'alice', age: 30 });
    await createUser({ name: 'bob', age: 30 });

    const result = await UserRepository.cqb().adults().where({ name: 'alice' }).getMany();

    expect(result.map((user) => user.id)).toEqual([alice.id]);
  });

  it('chains two custom methods', async () => {
    const alice = await createUser({ name: 'alice', age: 30 });
    await createUser({ name: 'carol', age: 30 });
    await createUser({ name: 'alice', age: 10 });

    const result = await UserRepository.cqb().adults().named('alice').getMany();

    expect(result.map((user) => user.id)).toEqual([alice.id]);
  });

  it('keeps each builder immutable', async () => {
    await createUser({ name: 'alice', age: 30 });

    const base = UserRepository.cqb().adults();
    const named = base.named('bob');

    expect(await base.getCount()).toBe(1);
    expect(await named.getCount()).toBe(0);
  });

  it('accepts an explicit alias', async () => {
    const alice = await createUser({ name: 'alice', age: 30 });
    await createUser({ name: 'bob', age: 10 });

    const result = await UserRepository.cqb('u')
      .named('alice')
      .where('u.age >= :min', { min: 18 })
      .getMany();

    expect(result.map((user) => user.id)).toEqual([alice.id]);
  });

  it('hydrates a relation from a custom join method and narrows the type', async () => {
    const alice = await createUser({ name: 'alice' });
    await createProfile({ bio: 'bio', user_id: alice.id });

    const user = await UserRepository.cqb().withProfile().where({ name: 'alice' }).getOneOrFail();

    expect(user.profile.bio).toBe('bio');
  });

  it('chains a built-in join filter after a custom join method', async () => {
    const alice = await createUser({ name: 'alice', age: 30 });
    await createProfile({ bio: 'bio', user_id: alice.id });
    await createUser({ name: 'bob', age: 30 });

    const result = await UserRepository.cqb()
      .hasProfile()
      .where('profile.bio = :bio', { bio: 'bio' })
      .adults()
      .getMany();

    expect(result.map((user) => user.id)).toEqual([alice.id]);
  });

  it('supports a join-based custom method on another repository (defined via a thunk)', async () => {
    const alice = await createUser({ name: 'alice' });
    const bob = await createUser({ name: 'bob' });
    await createPost({ title: 'title', user_id: alice.id });
    await createPost({ user_id: bob.id });

    const result = await PostRepository.cqb().authoredBy('alice').getMany();

    expect(result.map((post) => post.title)).toEqual(['title']);
  });

  it('runs against the repository passed to the factory, preserving its transaction context', async () => {
    await UserRepository.manager.transaction(async (manager) => {
      const alice = await manager.withRepository(UserRepository).save({ name: 'alice', age: 30 });
      const result = await manager.withRepository(UserRepository).cqb().adults().getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });
  });

  it('rejects an extension whose name collides with a built-in at compile time', () => {
    defineQueryBuilder(UserRepository, {
      // @ts-expect-error `where` collides with a built-in query builder method
      where() {
        return this.all();
      },
    });
  });

  it('keeps a join-narrowed type when a preserving custom method is chained after the join', async () => {
    const alice = await createUser({ name: 'alice' });
    await createPost({ title: 'title 1', user_id: alice.id });
    await createPost({ title: 'title 2', user_id: alice.id });

    const rows = await UserRepository.cqb()
      .withPosts()
      .where({ name: 'alice' })
      .orderedByName()
      .getMany();

    expect(rows[0].posts.map((post) => post.title).sort()).toEqual(['title 1', 'title 2']);
  });

  it('accumulates the narrowed type across multiple custom join methods', async () => {
    const alice = await createUser({ name: 'alice' });
    await createProfile({ bio: 'bio', user_id: alice.id });
    await createPost({ title: 'title', user_id: alice.id });

    const rows = await UserRepository.cqb()
      .withPosts()
      .withProfile()
      .where({ name: 'alice' })
      .orderedByName()
      .getMany();

    expect(rows[0].posts.map((post) => post.title)).toEqual(['title']);
    expect(rows[0].profile.bio).toBe('bio');
  });

  it('applies a shared, entity-generic extension and keeps join narrowing', async () => {
    const alice = await createUser({ name: 'alice' });
    await createPost({ title: 'title 1', user_id: alice.id });
    await createPost({ title: 'title 2', user_id: alice.id });

    const [rows, total] = await UserRepository.cqb()
      .withPosts()
      .where({ name: 'alice' })
      .paginate({ page: 1, perPage: 10 })
      .getManyAndCount();

    expect(rows[0].posts.map((post) => post.title).sort()).toEqual(['title 1', 'title 2']);
    expect(total).toBe(1);
  });

  it('keeps a custom method callable after select() and preserves the projection', async () => {
    await createUser({ name: 'alice', age: 30 });
    await createUser({ name: 'bob', age: 10 });

    const projected = UserRepository.cqb().select('users.name').adults();

    const rows = await projected.getRawMany();
    expect(rows.map((row) => row.users_name)).toEqual(['alice']);

    // @ts-expect-error getMany is unavailable after select()
    void projected.getMany;
  });
});
