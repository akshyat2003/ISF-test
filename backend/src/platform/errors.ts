import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError, type z } from "zod";
import type { Problem } from "@sj/contracts";
import { isUniqueViolation, ruleViolation } from "../db/client.js";

/** An expected failure that maps to an RFC 9457 problem response with a stable `code`. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
  }
}

export const unauthorized = (detail = "Sign in to continue") => new AppError(401, "unauthenticated", "Authentication required", detail);
export const forbidden = (detail = "You do not have permission for this action", code = "forbidden") =>
  new AppError(403, code, "Forbidden", detail);
export const notFound = (what: string) => new AppError(404, "not_found", "Not found", `${what} was not found`);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw r.error;
  return r.data;
}

function problem(p: Omit<Problem, "type"> & { type?: string }): Problem {
  return { type: p.type ?? `https://errors.startupjathara.example/${p.code}`, ...p } as Problem;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    let body: Problem;
    if (err instanceof AppError) {
      body = problem({ status: err.status, code: err.code, title: err.title, detail: err.detail, ...err.extra });
    } else if (err instanceof ZodError) {
      body = problem({
        status: 400,
        code: "validation_failed",
        title: "Some fields are invalid",
        errors: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    } else if ((err as FastifyError).statusCode === 429) {
      body = problem({ status: 429, code: "rate_limited", title: "Too many requests", detail: "Please wait a minute and try again" });
    } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      const s = (err as FastifyError).statusCode!;
      body = problem({ status: s, code: (err as FastifyError).code?.toLowerCase() ?? "bad_request", title: err.message });
    } else if (isUniqueViolation(err)) {
      body = problem({ status: 409, code: "conflict", title: "This record already exists" });
    } else if (ruleViolation(err)) {
      body = problem({ status: 409, code: "rule_violation", title: "Blocked by a platform rule", detail: ruleViolation(err)! });
    } else {
      req.log.error({ err }, "unhandled error");
      body = problem({ status: 500, code: "internal_error", title: "Something went wrong" });
    }
    reply.status(body.status).type("application/problem+json").send(body);
  });
  app.setNotFoundHandler((req, reply) => {
    reply
      .status(404)
      .type("application/problem+json")
      .send(problem({ status: 404, code: "route_not_found", title: "Not found", detail: `${req.method} ${req.url}` }));
  });
}
