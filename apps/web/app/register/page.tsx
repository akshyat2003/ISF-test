"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@sj/client";
import { checkFormAnswers, mergeQuestions, yearsFor, type PublicEdition, type RegistrationResponse, type YearOption } from "@sj/contracts";
import { api, useSessionIdentity } from "@/lib/session";

type Form = {
  yearOption: YearOption | "";
  name: string; description: string; website: string; city: string; state: string;
  fullName: string; mobile: string; privacy: boolean; adult: boolean;
};
const EMPTY: Form = { yearOption: "", name: "", description: "", website: "", city: "", state: "", fullName: "", mobile: "", privacy: false, adult: false };

const OPTIONS: { value: YearOption; label: string; years: number[] }[] = [
  { value: "2026", label: "2026 only", years: [2026] },
  { value: "2027", label: "2027 only", years: [2027] },
  { value: "both", label: "Both 2026 and 2027 (two separate applications)", years: [2026, 2027] },
];

export default function RegisterPage() {
  const email = useSessionIdentity();
  const [editions, setEditions] = useState<PublicEdition[] | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<RegistrationResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.editions().then(setEditions).catch(() => setEditions([])); }, []);
  const open = (year: number) => editions?.find((e) => e.year === year)?.registration.open ?? false;
  // The questions come from the chosen editions' form configuration (TBD-39); before a choice, the open editions'.
  const chosen = f.yearOption ? yearsFor(f.yearOption) : (editions ?? []).filter((e) => e.registration.open).map((e) => e.year);
  const questions = mergeQuestions((editions ?? []).filter((e) => chosen.includes(e.year as 2026 | 2027)).map((e) => e.applicationForm));
  const PATH: Record<keyof Form, string> = {
    yearOption: "yearOption", name: "startup.name", description: "startup.description", website: "startup.website",
    city: "startup.city", state: "startup.state", fullName: "leader.fullName", mobile: "leader.mobile", privacy: "privacyNoticeAccepted",
    adult: "adultDeclaration",
  };
  const answer = (k: string, v: string) => {
    setAnswers((p) => ({ ...p, [k]: v }));
    setErrors(({ [`formAnswers.${k}`]: _cleared, ...rest }) => rest);
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors(({ [PATH[k]]: _cleared, ...rest }) => rest);   // clear a field's error once it is edited
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setProblem(null);
    if (!f.yearOption) { setErrors({ yearOption: "Choose which year(s) to apply for" }); return; }
    const own = Object.fromEntries(questions.map((q) => [q.key, answers[q.key] ?? ""]));
    const issues = checkFormAnswers(questions, own);
    if (issues.length) {
      setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
      setProblem("Please answer every question.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.register({
        yearOption: f.yearOption,
        startup: { name: f.name, description: f.description, website: f.website || undefined, city: f.city || undefined, state: f.state || undefined },
        leader: { fullName: f.fullName, mobile: f.mobile },
        formAnswers: own,
        privacyNoticeAccepted: f.privacy as true,
        adultDeclaration: f.adult as true,
      });
      setDone(r);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setProblem(err.problem.code === "validation_failed" ? "Please correct the highlighted fields." : err.message);
      } else setProblem("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (email === undefined) return null;
  if (!email) {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        <h1>Register your startup</h1>
        <p>Sign in first with your email or mobile number. You will use the same sign-in to check your application status.</p>
        <Link className="btn btn-primary" href="/signin?next=/register">Sign in to continue</Link>
      </div>
    );
  }
  if (done) {
    return (
      <div className="card" style={{ maxWidth: 640 }}>
        <p className="notice notice-ok">Application submitted for {done.startup?.name}.</p>
        <ul>
          {done.applications.map((a) => <li key={a.id}>Startup Jathara {a.edition}: under review</li>)}
        </ul>
        <p className="muted small">Each year is reviewed separately. We will notify you when a decision is released.</p>
        <Link className="btn" href="/status">View application status</Link>
      </div>
    );
  }

  const err = (k: string) => errors[k] && <span className="field-error">{errors[k]}</span>;
  return (
    <form onSubmit={submit} noValidate style={{ maxWidth: 720 }}>
      <div>
        <h1>Register your startup</h1>
        <p className="muted">Signed in as {email}. Fields marked * are required.</p>
      </div>
      {problem && <p className="notice notice-error" role="alert">{problem}</p>}

      <fieldset>
        <legend>Which event? *</legend>
        <div className="choices" role="radiogroup">
          {OPTIONS.map((o) => {
            const disabled = !editions || !o.years.every(open);
            return (
              <label className="choice" key={o.value}>
                <input type="radio" name="yearOption" value={o.value} disabled={disabled}
                  checked={f.yearOption === o.value} onChange={() => set("yearOption", o.value)} />
                <span>{o.label}{disabled && editions && <span className="hint"> — registration closed</span>}</span>
              </label>
            );
          })}
        </div>
        {err("yearOption")}
      </fieldset>

      <fieldset>
        <legend>Startup</legend>
        <label>Startup name *<input type="text" value={f.name} onChange={(e) => set("name", e.target.value)} />{err("startup.name")}</label>
        <label>What does your startup do? *<span className="hint">At least 20 characters.</span>
          <textarea value={f.description} onChange={(e) => set("description", e.target.value)} />{err("startup.description")}</label>
        <label>Website<input type="url" placeholder="https://" value={f.website} onChange={(e) => set("website", e.target.value)} />{err("startup.website")}</label>
        <div className="two">
          <label>City<input type="text" value={f.city} onChange={(e) => set("city", e.target.value)} /></label>
          <label>State<input type="text" value={f.state} onChange={(e) => set("state", e.target.value)} /></label>
        </div>
      </fieldset>

      {questions.length > 0 && (
        <fieldset>
          <legend>About your startup</legend>
          {questions.map((q) => (
            <label key={q.key}>{q.label} *
              <span className="hint">{q.help ? `${q.help} ` : ""}{q.minLength}–{q.maxLength.toLocaleString("en-IN")} characters.</span>
              <textarea value={answers[q.key] ?? ""} maxLength={q.maxLength} onChange={(e) => answer(q.key, e.target.value)} />
              {err(`formAnswers.${q.key}`)}
            </label>
          ))}
        </fieldset>
      )}

      <fieldset>
        <legend>Team leader</legend>
        <label>Full name *<input type="text" autoComplete="name" value={f.fullName} onChange={(e) => set("fullName", e.target.value)} />{err("leader.fullName")}</label>
        <label>Mobile number *<span className="hint">Used for event updates and Help Desk recognition on WhatsApp.</span>
          <input type="tel" autoComplete="tel" value={f.mobile} onChange={(e) => set("mobile", e.target.value)} />{err("leader.mobile")}</label>
      </fieldset>

      <label className="choice">
        <input type="checkbox" checked={f.privacy} onChange={(e) => set("privacy", e.target.checked)} />
        <span>I have read the <Link href="/privacy" target="_blank">privacy notice</Link> *</span>
      </label>
      {err("privacyNoticeAccepted")}
      <label className="choice">
        <input type="checkbox" checked={f.adult} onChange={(e) => set("adult", e.target.checked)} />
        <span>I confirm that I am 18 years of age or older *</span>
      </label>
      {err("adultDeclaration")}

      <div><button className="btn btn-primary" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button></div>
    </form>
  );
}
