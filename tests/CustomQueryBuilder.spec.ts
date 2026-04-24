import { describe, expect, it } from 'vitest';
import { UserRepository } from './repositories/UserRepository';
import { ProfileRepository } from './repositories/ProfileRepository';
import { PostRepository } from './repositories/PostRepository';

async function createUser(name: string, age: number | null = null) {
  return await UserRepository.save({ name, age });
}

describe('CustomQueryBuilder', () => {
  describe('where', () => {
    it('matches by object equality', async () => {
      const alice = await createUser('alice', 30);
      await createUser('bob', 40);

      const result = await UserRepository.qb().where({ name: 'alice' }).getOne();

      expect(result?.id).toBe(alice.id);
    });

    it('handles IS NULL for null values in an object condition', async () => {
      const noAge = await createUser('noAge', null);
      await createUser('withAge', 25);

      const result = await UserRepository.qb().where({ age: null }).getMany();

      expect(result.map((user) => user.id)).toEqual([noAge.id]);
    });

    it('combines multiple object keys with AND', async () => {
      await createUser('alice', 30);
      await createUser('alice', 40);
      const target = await createUser('alice', 25);

      const result = await UserRepository.qb().where({ name: 'alice', age: 25 }).getOne();

      expect(result?.id).toBe(target.id);
    });

    it('wraps raw SQL conditions in parentheses to preserve precedence', async () => {
      const alice = await createUser('alice', 30);
      const bob = await createUser('bob', 40);
      await createUser('carol', 50);

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
      const alice = await createUser('alice', 30);
      await createUser('bob', 40);

      const result = await UserRepository.qb()
        .where('users.name = :value', { value: 'alice' })
        .where('users.age = :value', { value: 30 })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });

    it('returns a new instance without mutating the original', async () => {
      await createUser('alice', 30);
      await createUser('bob', 40);

      const base = UserRepository.qb();
      const filtered = base.where({ name: 'alice' });

      const baseResult = await base.getMany();
      const filteredResult = await filtered.getMany();

      expect(baseResult).toHaveLength(2);
      expect(filteredResult).toHaveLength(1);
    });
  });

  describe('whereNot', () => {
    it('excludes by object equality', async () => {
      await createUser('alice', 30);
      const bob = await createUser('bob', 40);

      const result = await UserRepository.qb().whereNot({ name: 'alice' }).getMany();

      expect(result.map((user) => user.id)).toEqual([bob.id]);
    });

    it('handles IS NOT NULL for null values in an object condition', async () => {
      await createUser('noAge', null);
      const withAge = await createUser('withAge', 25);

      const result = await UserRepository.qb().whereNot({ age: null }).getMany();

      expect(result.map((user) => user.id)).toEqual([withAge.id]);
    });

    it('negates a raw SQL condition', async () => {
      const alice = await createUser('alice', 30);
      await createUser('bob', 40);

      const result = await UserRepository.qb()
        .whereNot('users.name = :name', { name: 'bob' })
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
    });
  });

  describe('leftJoinAndSelect', () => {
    it('joins and hydrates the related entity', async () => {
      const alice = await createUser('alice', 30);
      await ProfileRepository.save({ bio: 'hello', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoinAndSelect<['profile']>('users.profile', 'profile')
        .where({ id: alice.id })
        .getOne();

      expect(result?.profile?.bio).toBe('hello');
    });
  });

  describe('loadRelationCountAndMap', () => {
    it('counts a relation and maps the result onto a property', async () => {
      const alice = await createUser('alice', 30);
      await PostRepository.save({ title: 'one', user_id: alice.id });
      await PostRepository.save({ title: 'two', user_id: alice.id });

      const result = await UserRepository.qb()
        .loadRelationCountAndMap<'postCount', ['posts']>('users.postCount', 'users.posts')
        .where({ id: alice.id })
        .getOne();

      expect(result?.postCount).toBe(2);
    });
  });

  describe('leftJoin', () => {
    it('joins without selecting the related entity', async () => {
      const alice = await createUser('alice', 30);
      await ProfileRepository.save({ bio: 'hello', user_id: alice.id });

      const result = await UserRepository.qb()
        .leftJoin<['profile']>('users.profile', 'profile')
        .where('profile.bio = :bio', { bio: 'hello' })
        .getOne();

      expect(result?.id).toBe(alice.id);
      expect(result?.profile).toBeUndefined();
    });
  });

  describe('innerJoinAndSelect', () => {
    it('only returns rows that have a matching relation', async () => {
      const alice = await createUser('alice', 30);
      await createUser('bob', 40);
      await ProfileRepository.save({ bio: 'hello', user_id: alice.id });

      const result = await UserRepository.qb()
        .innerJoinAndSelect<['profile']>('users.profile', 'profile')
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
      expect(result[0].profile?.bio).toBe('hello');
    });
  });

  describe('innerJoin', () => {
    it('filters to rows with a matching relation without hydrating it', async () => {
      const alice = await createUser('alice', 30);
      await createUser('bob', 40);
      await ProfileRepository.save({ bio: 'hello', user_id: alice.id });

      const result = await UserRepository.qb()
        .innerJoin<['profile']>('users.profile', 'profile')
        .getMany();

      expect(result.map((user) => user.id)).toEqual([alice.id]);
      expect(result[0].profile).toBeUndefined();
    });
  });

  describe('orderBy', () => {
    it('orders by an object map of column to direction', async () => {
      await createUser('carol', 50);
      await createUser('alice', 30);
      await createUser('bob', 40);

      const result = await UserRepository.qb().orderBy({ name: 'ASC' }).getMany();

      expect(result.map((user) => user.name)).toEqual(['alice', 'bob', 'carol']);
    });

    it('orders by a raw column expression with explicit direction', async () => {
      await createUser('alice', 30);
      await createUser('bob', 40);
      await createUser('carol', 50);

      const result = await UserRepository.qb().orderBy('users.age', 'DESC').getMany();

      expect(result.map((user) => user.name)).toEqual(['carol', 'bob', 'alice']);
    });
  });

  describe('groupBy', () => {
    it('groups raw rows by a column', async () => {
      await createUser('alice', 30);
      await createUser('alice', 40);
      await createUser('bob', 25);

      const rows = await UserRepository.qb()
        .select(['users.name AS name', 'COUNT(*)::int AS count'])
        .groupBy('users.name')
        .orderBy('name', 'ASC')
        .getRawMany();

      expect(rows).toEqual([
        { name: 'alice', count: 2 },
        { name: 'bob', count: 1 },
      ]);
    });
  });

  describe('skip / take / limit', () => {
    it('paginates results with skip and take', async () => {
      await createUser('alice', 30);
      await createUser('bob', 40);
      await createUser('carol', 50);

      const page = await UserRepository.qb()
        .orderBy({ name: 'ASC' })
        .skip(1)
        .take(1)
        .getMany();

      expect(page.map((user) => user.name)).toEqual(['bob']);
    });

    it('applies a SQL LIMIT', async () => {
      await createUser('alice', 30);
      await createUser('bob', 40);

      const sql = UserRepository.qb().limit(1).getSql();
      expect(sql).toMatch(/LIMIT 1/i);

      const result = await UserRepository.qb().orderBy({ name: 'ASC' }).limit(1).getMany();
      expect(result).toHaveLength(1);
    });
  });

  describe('select', () => {
    it('returns raw rows and forbids getOne after select at the type level', async () => {
      await createUser('alice', 30);

      const projected = UserRepository.qb().select(['users.name']);

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
      await createUser('alice', 30);

      const projected = UserRepository.qb().select(['users.name']);
      const escapeHatch = projected as unknown as { getOne(): Promise<unknown>, getMany(): Promise<unknown>, getOneOrFail(): Promise<unknown> };

      expect(() => escapeHatch.getOne()).toThrow(/getOne cannot be used after select/);
      expect(() => escapeHatch.getMany()).toThrow(/getMany cannot be used after select/);
      expect(() => escapeHatch.getOneOrFail()).toThrow(/getOneOrFail cannot be used after select/);
    });

    it('appends to a running selection list when called twice', async () => {
      await createUser('alice', 30);

      const rows = await UserRepository.qb()
        .select(['users.name'])
        .select(['users.age'])
        .getRawMany();

      expect(rows).toEqual([{ users_name: 'alice', users_age: 30 }]);
    });
  });

  describe('getOneOrFail', () => {
    it('rejects when no row matches', async () => {
      await expect(UserRepository.qb().where({ name: 'missing' }).getOneOrFail()).rejects.toThrow();
    });

    it('returns the row when one matches', async () => {
      const alice = await createUser('alice', 30);

      const result = await UserRepository.qb().where({ id: alice.id }).getOneOrFail();

      expect(result.id).toBe(alice.id);
    });
  });

  describe('getCount', () => {
    it('returns the number of matching rows', async () => {
      await createUser('alice', 30);
      await createUser('bob', 40);
      await createUser('carol', 50);

      const count = await UserRepository.qb().where('users.age >= :min', { min: 40 }).getCount();

      expect(count).toBe(2);
    });
  });

  describe('getManyAndCount', () => {
    it('returns rows and total count honouring take', async () => {
      await createUser('alice', 30);
      await createUser('bob', 40);
      await createUser('carol', 50);

      const [rows, count] = await UserRepository.qb().orderBy({ name: 'ASC' }).take(2).getManyAndCount();

      expect(rows.map((user) => user.name)).toEqual(['alice', 'bob']);
      expect(count).toBe(3);
    });
  });

  describe('getExists', () => {
    it('returns true if a matching row exists, false otherwise', async () => {
      await createUser('alice', 30);

      await expect(UserRepository.qb().where({ name: 'alice' }).getExists()).resolves.toBe(true);
      await expect(UserRepository.qb().where({ name: 'missing' }).getExists()).resolves.toBe(false);
    });
  });

  describe('getRawOne', () => {
    it('returns a single raw row', async () => {
      await createUser('alice', 30);

      const row = await UserRepository.qb().select(['users.name']).getRawOne();

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
      const sql = UserRepository.qb().setLock('pessimistic_write').getSql();
      expect(sql).toMatch(/FOR UPDATE/i);
    });

    it('throws if optimistic lock is requested without a version', () => {
      expect(() => UserRepository.qb().setLock('optimistic')).toThrow(/Lock version must be provided/);
    });
  });

  describe('delete', () => {
    it('removes matching rows', async () => {
      const alice = await createUser('alice', 30);
      await createUser('bob', 40);

      UserRepository.qb().where({ id: alice.id }).delete();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const remaining = await UserRepository.find();
      expect(remaining.map((user) => user.name)).toEqual(['bob']);
    });
  });

  describe('update', () => {
    it('applies a plain object update', async () => {
      const alice = await createUser('alice', 30);

      await UserRepository.qb().where({ id: alice.id }).update({ age: 31 });

      const updated = await UserRepository.findOneByOrFail({ id: alice.id });
      expect(updated.age).toBe(31);
    });

    it('applies a raw SQL expression with parameters', async () => {
      const alice = await createUser('alice', 30);

      await UserRepository.qb()
        .where({ id: alice.id })
        .update({ age: () => '"age" + :inc' }, { inc: 5 });

      const updated = await UserRepository.findOneByOrFail({ id: alice.id });
      expect(updated.age).toBe(35);
    });
  });
});
