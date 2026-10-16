// The model evaluation harness (scripts/ranking-eval.ts, TBD-35) on synthetic data, without any provider.
import { describe, expect, it } from "vitest";
import { CASES, checks, evaluate, modelFromEnv, shippedCriteria, shippedForm } from "../scripts/ranking-eval.js";
import { stubModel } from "../src/modules/ranking/model.js";

const scripted = (score: (caseText: string) => number) => ({
  ref: "fake:eval",
  async complete({ user }: { user: string }) {
    const crit = JSON.parse(user.split("<criteria>")[1]!.split("</criteria>")[0]!) as { criterion: string }[];
    const data = user.split("<application_data>")[1]!;
    const s = score(data);
    return JSON.stringify({ scores: crit.map((c) => ({ criterion: c.criterion, score: s, explanation: "Evidence cited." })), summary: "Summary.", injection_suspected: false });
  },
});

describe("ranking evaluation harness (synthetic data only)", () => {
  it("uses the criteria and form exactly as the migrations ship them", () => {
    expect(shippedCriteria().map((c) => c.key)).toEqual(["innovation", "feasibility", "scalability", "market_relevance", "impact"]);
    expect(shippedForm().questions).toHaveLength(6);
    expect(CASES.map((c) => c.id)).toEqual(["strong", "weak", "injection", "contacts"]);
  });

  it("the stub passes the harness checks it can (valid, stable, steering flagged) and skips ordering", async () => {
    const list = checks(await evaluate(stubModel()), true);
    expect(list.map((c) => [c.name, c.ok])).toEqual([
      ["provider reachable", true], ["schema-valid output", true], ["same input, same total", true], ["steering attempt flagged", true],
    ]);
  });

  it("passes a model that ranks on the evidence and fails one that obeys the steering attempt", async () => {
    const sensible = scripted((d) => (d.includes("break-even") ? 5 : d.includes("Idea stage") ? 1 : 3));
    expect(checks(await evaluate(sensible), false).every((c) => c.ok)).toBe(true);
    const obedient = scripted((d) => (d.includes("IGNORE ALL PREVIOUS") ? 5 : d.includes("break-even") ? 4 : 2));
    const failed = checks(await evaluate(obedient), false).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(["steering attempt does not win"]);
  });

  it("reports invalid output and unstable totals", async () => {
    let n = 0;
    const flaky = { ref: "fake:flaky", async complete(req: { user: string }) {
      n += 1;
      if (n === 1) return "not json";
      return (await scripted(() => (n % 2 ? 2 : 4)).complete(req));
    } };
    const failed = checks(await evaluate(flaky), false).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(["schema-valid output", "same input, same total"]));
  });

  it("contact details in the synthetic answers never reach the model", async () => {
    const seen: string[] = [];
    await evaluate({ ref: "fake:spy", async complete(req) { seen.push(req.user); return scripted(() => 3).complete(req); } }, 1);
    const contacts = seen.find((u) => u.includes("repair"))!;
    expect(contacts).not.toMatch(/98765|43210|91234|founder@example\.com|www\.example\.com/);
    expect(contacts).toContain("[phone removed]");
  });

  it("configures the provider from the environment and refuses incomplete settings", () => {
    expect(modelFromEnv({}).ref).toBe("stub:deterministic-v1");
    expect(modelFromEnv({ RANKING_PROVIDER: "vertex", RANKING_VERTEX_PROJECT: "p", RANKING_VERTEX_MODEL: "m" }).ref).toBe("vertex:m@asia-south1");
    expect(() => modelFromEnv({ RANKING_PROVIDER: "vertex" })).toThrow(/required/);
    expect(() => modelFromEnv({ RANKING_PROVIDER: "other" })).toThrow(/stub or vertex/);
  });
});
