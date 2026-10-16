import postgres from "postgres";

export type Sql = postgres.Sql;
/** Anything a query can run on: the pool or an open transaction. */
export type Db = postgres.Sql | postgres.TransactionSql;

export function createSql(url: string, opts: { max?: number } = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    connection: { application_name: "sj-api", TimeZone: "UTC" },
  });
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!(err instanceof postgres.PostgresError) || err.code !== "23505") return false;
  return constraint ? err.constraint_name === constraint : true;
}

/** Errors raised by our own triggers (errcode P0001) carry the PRD rule id in the hint, e.g. "DC-02". */
export function ruleViolation(err: unknown): string | null {
  return err instanceof postgres.PostgresError && err.code === "P0001" ? (err.hint ?? "rule") : null;
}
