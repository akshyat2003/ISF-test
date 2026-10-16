import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Text } from "react-native";
import { ApiError } from "@sj/client";
import { checkFormAnswers, mergeQuestions, yearsFor, type PublicEdition, type RegistrationResponse, type YearOption } from "@sj/contracts";
import { Button, Card, Check, Choice, Field, H1, H2, Notice, P, Screen, colors } from "../components/ui";
import { WEB_URL } from "../lib/config";
import { messageOf, useSession } from "../lib/session";

const OPTIONS: { value: YearOption; label: string; years: number[] }[] = [
  { value: "2026", label: "2026 only", years: [2026] },
  { value: "2027", label: "2027 only", years: [2027] },
  { value: "both", label: "Both 2026 and 2027 (two separate applications)", years: [2026, 2027] },
];

/** New-startup registration, same rules as the website (PRD §6): the API enforces deadlines and duplicates. */
export default function Register() {
  const { api, me } = useSession();
  const [editions, setEditions] = useState<PublicEdition[] | null>(null);
  const [year, setYear] = useState<YearOption | null>(null);
  const [f, setF] = useState({ name: "", description: "", website: "", city: "", state: "", fullName: me?.account?.fullName ?? "", mobile: me?.account?.mobile ?? "" });
  const [privacy, setPrivacy] = useState(false);
  const [adult, setAdult] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RegistrationResponse | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => { api.editions().then(setEditions, (e) => setProblem(messageOf(e))); }, [api]);
  const open = (y: number) => !!editions?.find((e) => e.year === y)?.registration.open;
  // Questions come from the chosen editions' form configuration (TBD-39), so wording changes need no app release.
  const chosen = year ? yearsFor(year) : (editions ?? []).filter((e) => e.registration.open).map((e) => e.year);
  const questions = mergeQuestions((editions ?? []).filter((e) => chosen.includes(e.year as 2026 | 2027)).map((e) => e.applicationForm));

  async function submit() {
    if (!year) { setErrors({ yearOption: "Choose which year(s) to apply for" }); return; }
    const own = Object.fromEntries(questions.map((q) => [q.key, answers[q.key] ?? ""]));
    const issues = checkFormAnswers(questions, own);
    if (issues.length) {
      setErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
      setProblem("Please answer every question.");
      return;
    }
    setBusy(true); setErrors({}); setProblem(null);
    try {
      setDone(await api.register({
        yearOption: year,
        startup: { name: f.name, description: f.description, website: f.website, city: f.city || undefined, state: f.state || undefined },
        leader: { fullName: f.fullName, mobile: f.mobile },
        formAnswers: own,
        privacyNoticeAccepted: privacy as true,
        adultDeclaration: adult as true,
      }));
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors?.length) setErrors(e.fieldErrors());
      setProblem(messageOf(e));
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <Screen>
        <Notice kind="ok">{`Application submitted for ${done.startup?.name}.`}</Notice>
        {done.applications.map((a) => <P key={a.id}>Startup Jathara {a.edition}: under review</P>)}
        <P muted>Each year is reviewed separately. You will get a message here when a decision is released.</P>
        <Button title="View application status" onPress={() => router.replace("/status")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>Register your startup</H1>
      <P muted>Fields marked * are required.</P>
      {problem && <Notice kind="error">{problem}</Notice>}
      <Card>
        <H2>Which year? *</H2>
        {OPTIONS.map((o) => {
          const closed = !!editions && o.years.some((y) => !open(y));
          return <Choice key={o.value} label={o.label} selected={year === o.value} disabled={closed} note={closed ? "registration closed" : undefined} onPress={() => setYear(o.value)} />;
        })}
        {errors.yearOption ? <Text style={{ color: colors.danger }}>{errors.yearOption}</Text> : null}
      </Card>
      <Card>
        <H2>Startup</H2>
        <Field label="Startup name *" value={f.name} onChangeText={set("name")} error={errors["startup.name"]} />
        <Field label="What does your startup do? *" hint="At least 20 characters." value={f.description} onChangeText={set("description")} multiline error={errors["startup.description"]} />
        <Field label="Website" placeholder="https://" value={f.website} onChangeText={set("website")} autoCapitalize="none" keyboardType="url" error={errors["startup.website"]} />
        <Field label="City" value={f.city} onChangeText={set("city")} />
        <Field label="State" value={f.state} onChangeText={set("state")} />
      </Card>
      {questions.length > 0 && (
        <Card>
          <H2>About your startup</H2>
          {questions.map((q) => (
            <Field key={q.key} label={`${q.label} *`} hint={`${q.help ? `${q.help} ` : ""}${q.minLength}–${q.maxLength} characters.`}
              value={answers[q.key] ?? ""} onChangeText={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))} multiline
              maxLength={q.maxLength} error={errors[`formAnswers.${q.key}`]} />
          ))}
        </Card>
      )}
      <Card>
        <H2>Team leader</H2>
        <Field label="Full name *" value={f.fullName} onChangeText={set("fullName")} autoComplete="name" error={errors["leader.fullName"]} />
        <Field label="Mobile number *" hint="Used for event updates and Help Desk recognition on WhatsApp." value={f.mobile} onChangeText={set("mobile")}
          keyboardType="phone-pad" autoComplete="tel" error={errors["leader.mobile"]} />
      </Card>
      <Text accessibilityRole="link" style={{ color: colors.accent, textDecorationLine: "underline" }}
        onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)}>Read the privacy notice</Text>
      <Check label="I have read the privacy notice" checked={privacy} onChange={setPrivacy}>
        <Text>I have read the privacy notice *</Text>
      </Check>
      {errors.privacyNoticeAccepted ? <Text style={{ color: colors.danger }}>{errors.privacyNoticeAccepted}</Text> : null}
      <Check label="I confirm that I am 18 years of age or older" checked={adult} onChange={setAdult}>
        <Text>I confirm that I am 18 years of age or older *</Text>
      </Check>
      {errors.adultDeclaration ? <Text style={{ color: colors.danger }}>{errors.adultDeclaration}</Text> : null}
      <Button title="Submit application" busy={busy} onPress={() => void submit()} />
    </Screen>
  );
}
