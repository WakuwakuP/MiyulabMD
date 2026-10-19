import { DatabaseSync } from "node:sqlite";

/** Execute real SQLite SQL while counting Worker-to-D1 calls. */
export function testD1() {
  const sqlite = new DatabaseSync(":memory:");
  let calls = 0;
  function prepare(sql, values = []) {
    return {
      all() {
        calls++;
        return Promise.resolve({ results: sqlite.prepare(sql).all(...values) });
      },
      bind(...bound) {
        return prepare(sql, bound);
      },
      first() {
        calls++;
        return Promise.resolve(sqlite.prepare(sql).get(...values) ?? null);
      },
      run() {
        calls++;
        const result = sqlite.prepare(sql).run(...values);
        return Promise.resolve({
          meta: { changes: result.changes },
          success: true,
        });
      },
      sql,
      values,
    };
  }
  return {
    get calls() {
      return calls;
    },
    env: {
      DB: {
        batch(statements) {
          calls++;
          sqlite.exec("BEGIN");
          try {
            const result = statements.map(({ sql, values }) => ({
              results: sqlite.prepare(sql).all(...values),
              success: true,
            }));
            sqlite.exec("COMMIT");
            return Promise.resolve(result);
          } catch (error) {
            sqlite.exec("ROLLBACK");
            return Promise.reject(error);
          }
        },
        prepare,
      },
    },
    sqlite,
  };
}
