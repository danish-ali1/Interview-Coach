/**
 * A tiny in-memory stand-in for the Mongoose models used by the auth service.
 *
 * It implements ONLY the query shapes the auth service issues (equality, `null` matching a missing
 * field, `$gt`) and mimics the Mongoose behaviours the service depends on (findOneAndUpdate returns
 * the document as it was BEFORE the update; `unique` on tokenHash). It is a test aid for the
 * service's control flow, not proof of MongoDB semantics: those need the integration tests.
 */

let idCounter = 0;
const nextId = () => `id${String((idCounter += 1)).padStart(6, '0')}`;

function matches(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (expected === null) return actual === null || actual === undefined;
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && '$gt' in expected) {
      return actual !== undefined && actual > expected.$gt;
    }
    return String(actual) === String(expected);
  });
}

const clone = (doc) => (doc ? { ...doc } : doc);

export function createFakeRefreshTokens({ beforeCreate } = {}) {
  const rows = [];
  return {
    rows,
    async create(data) {
      if (beforeCreate) await beforeCreate(data); // lets a test hold a request mid-flight
      if (rows.some((r) => r.tokenHash === data.tokenHash)) throw Object.assign(new Error('dup'), { code: 11000 });
      const row = { _id: nextId(), revokedAt: null, replacedBy: null, ...data };
      rows.push(row);
      return clone(row);
    },
    async findOneAndUpdate(filter, update) {
      const row = rows.find((r) => matches(r, filter));
      if (!row) return null;
      const before = clone(row);
      Object.assign(row, update.$set);
      return before;
    },
    async findOne(filter) {
      return clone(rows.find((r) => matches(r, filter)) ?? null);
    },
    async updateOne(filter, update) {
      const row = rows.find((r) => matches(r, filter));
      if (row) Object.assign(row, update.$set);
      return { matchedCount: row ? 1 : 0 };
    },
    async updateMany(filter, update) {
      const hit = rows.filter((r) => matches(r, filter));
      hit.forEach((r) => Object.assign(r, update.$set));
      return { matchedCount: hit.length };
    },
  };
}

export function createFakeUsers() {
  const rows = [];
  const wrap = (row) =>
    row && {
      ...row,
      id: row._id,
      toJSON: () => ({ id: row._id, name: row.name, email: row.email }),
    };
  return {
    rows,
    async exists(filter) {
      return rows.some((r) => matches(r, filter)) ? { _id: 'x' } : null;
    },
    async create(data) {
      const row = { _id: nextId(), ...data };
      rows.push(row);
      return wrap(row);
    },
    findOne(filter) {
      const row = rows.find((r) => matches(r, filter));
      // The real query supports .select('+passwordHash'); the fake always returns the hash.
      return { select: async () => wrap(row) };
    },
    async findById(id) {
      return wrap(rows.find((r) => r._id === id));
    },
  };
}
