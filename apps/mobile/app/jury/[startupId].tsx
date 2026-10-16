// A startup's authorised profile (no contact details, no AI data) and, for an assigned startup, the scoring form
// against the approved rubric (FR-JRY-04, -06…09). Submitted scores are locked; only Management can reopen them.
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ApiError, formatIst } from "@sj/client";
import type { JuryHome, JuryStartupProfile } from "@sj/contracts";
import { Button, Card, Field, H1, H2, Loading, Notice, P, Screen, colors } from "../../components/ui";
import { choices, previewTotal, toPayload, unscored, type ScoreDraft } from "../../lib/scoring";
import { messageOf, useSession } from "../../lib/session";

export default function JuryStartup() {
  const { api } = useSession();
  const params = useLocalSearchParams<{ startupId: string; year?: string }>();
  const year = Number(params.year ?? 2026);
  const [profile, setProfile] = useState<JuryStartupProfile | null>(null);
  const [home, setHome] = useState<JuryHome | null>(null);
  const [draft, setDraft] = useState<ScoreDraft>({});
  const [comments, setComments] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (h: JuryHome) => {
    setHome(h);
    const ev = h.startups.find((s) => s.startupId === params.startupId)?.evaluation;
    setDraft(ev ? { ...ev.scores } : {});
    setComments(ev?.comments ?? "");
  };
  useFocusEffect(useCallback(() => {
    setError(null);
    Promise.all([api.jury.startup(year, params.startupId), api.jury.home(year)])
      .then(([p, h]) => { setProfile(p); apply(h); }, (e) => setError(messageOf(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, year, params.startupId]));

  if (error) return <Screen><Notice kind="error">{error}</Notice></Screen>;
  if (!profile || !home) return <Screen><Loading /></Screen>;
  const mine = home.startups.find((s) => s.startupId === profile.id);
  const ev = mine?.evaluation ?? null;
  const rubric = home.rubric;
  const locked = ev?.state === "submitted";
  const total = rubric ? previewTotal(rubric.parameters, draft) : null;

  async function save(submit: boolean) {
    if (!rubric) return;
    setBusy(true); setErrors({}); setMessage(null); setError(null);
    try {
      const body = toPayload(rubric.parameters, draft, comments, rubric.commentsAllowed);
      apply(submit ? await api.jury.submit(year, profile!.id, body) : await api.jury.saveDraft(year, profile!.id, body));
      setMessage(submit ? "Scores submitted. They are now locked." : "Draft saved. You can finish it later.");
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors?.length) setErrors(e.fieldErrors());
      else setError(messageOf(e));
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <H1>{profile.name}</H1>
      {profile.city ? <P muted>{profile.city}{profile.state ? `, ${profile.state}` : ""}</P> : null}
      {profile.description ? <P>{profile.description}</P> : null}
      {profile.website ? <P muted small>{profile.website}</P> : null}
      {profile.founders.length > 0 && (
        <Card>
          <H2>Founders</H2>
          {profile.founders.map((f, i) => <P key={i}>{f.fullName}{f.position === "leader" ? " (team leader)" : ""}</P>)}
        </Card>
      )}
      {profile.answers.length > 0 && (
        <Card>
          <H2>Application</H2>
          {profile.answers.map((a, i) => (
            <View key={i} style={{ gap: 2, marginBottom: 6 }}>
              <Text style={{ fontWeight: "600", color: colors.ink }}>{a.question}</Text>
              <P>{a.answer}</P>
            </View>
          ))}
        </Card>
      )}

      {!profile.assigned ? (
        <Notice kind="warn">This startup is pitching now but is not assigned to you, so you cannot score it.</Notice>
      ) : !rubric ? (
        <Notice kind="warn">Scoring opens when Management approves the scoring rubric.</Notice>
      ) : (
        <Card>
          <H2>Your scores</H2>
          <P muted small>
            Rubric version {locked && ev ? ev.rubricVersion : rubric.version}. {locked && ev?.submittedAt ? `Submitted ${formatIst(ev.submittedAt)} IST and locked. Ask Management if a correction is needed.` : "Score every parameter, then submit. You can save a draft first."}
          </P>
          {ev?.state === "reopened" && <Notice kind="warn">Management reopened your scores. Correct them and submit again.</Notice>}
          {message && <Notice kind="ok">{message}</Notice>}
          {rubric.parameters.map((p) => (
            <View key={p.key} style={{ gap: 6, marginTop: 8 }}>
              <Text style={{ fontWeight: "700", color: colors.ink }}>{p.label} <Text style={{ fontWeight: "400", color: colors.muted }}>({p.min}–{p.max})</Text></Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{p.description}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={p.label}>
                {choices(p).map((n) => {
                  const on = draft[p.key] === n;
                  return (
                    <Pressable key={n} disabled={locked || busy} onPress={() => setDraft({ ...draft, [p.key]: n })}
                      accessibilityRole="radio" accessibilityLabel={`${p.label} ${n}`} accessibilityState={{ checked: on, disabled: locked || busy }}
                      style={{ minWidth: 40, minHeight: 40, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center",
                        borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : colors.card, opacity: locked && !on ? 0.5 : 1 }}>
                      <Text style={{ color: on ? "#fff" : colors.ink, fontWeight: "600" }}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {errors[`scores.${p.key}`] ? <Text style={{ color: colors.danger, fontSize: 13 }}>{errors[`scores.${p.key}`]}</Text> : null}
            </View>
          ))}
          {rubric.commentsAllowed && (
            <Field label="Comments (optional)" value={comments} onChangeText={setComments} multiline maxLength={2000} editable={!locked} error={errors.comments} />
          )}
          <P>{locked && ev ? `Total: ${ev.totalScore} / 100` : total !== null ? `Total if submitted: ${total} / 100` : `${unscored(rubric.parameters, draft).length} parameter(s) still to score`}</P>
          {!locked && (
            <View style={{ gap: 8 }}>
              <Button title="Submit scores" onPress={() => void save(true)} busy={busy} disabled={total === null} />
              <Button title="Save draft" kind="secondary" onPress={() => void save(false)} disabled={busy} />
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}
