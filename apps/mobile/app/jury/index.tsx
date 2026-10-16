// Jury member: the startups assigned to them, the pitch schedule, the startup now pitching and their own scores only
// (FR-JRY-03, -14, -15). The API enforces the assignment scope; this screen only shows what it returns.
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { formatIst } from "@sj/client";
import type { JuryHome } from "@sj/contracts";
import { Badge, Card, H1, H2, Loading, Notice, P, Screen } from "../../components/ui";
import { messageOf, useSession } from "../../lib/session";

const STATE: Record<string, { text: string; tone: "ok" | "warn" | "neutral" }> = {
  draft: { text: "Draft saved", tone: "warn" }, submitted: { text: "Submitted", tone: "ok" }, reopened: { text: "Reopened: please resubmit", tone: "warn" },
};

export default function JuryList() {
  const { api } = useSession();
  const year = Number(useLocalSearchParams<{ year?: string }>().year ?? 2026);
  const [home, setHome] = useState<JuryHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { setError(null); api.jury.home(year).then(setHome, (e) => setError(messageOf(e))); }, [api, year]));

  if (error) return <Screen><Notice kind="error">{error}</Notice></Screen>;
  if (!home) return <Screen><Loading /></Screen>;
  const open = (startupId: string) => router.push({ pathname: "/jury/[startupId]", params: { startupId, year: String(year) } });
  const done = home.startups.filter((s) => s.evaluation?.state === "submitted").length;

  return (
    <Screen>
      <H1>Jury · {year}</H1>
      {!home.rubric && <Notice kind="warn">Scoring opens when Management approves the scoring rubric.</Notice>}
      {home.currentPitch && (
        <Card onPress={() => open(home.currentPitch!.startupId)} label={`Now pitching: ${home.currentPitch.startupName}`}>
          <Badge text="Now pitching" tone="ok" />
          <H2>{home.currentPitch.startupName}</H2>
          {home.currentPitch.venue ? <P muted>{home.currentPitch.venue}</P> : null}
          {!home.currentPitch.assigned && <P muted small>Not one of your assigned startups: you can view its profile but not score it.</P>}
        </Card>
      )}
      <H2>Your startups</H2>
      <P muted small>{home.startups.length ? `${done} of ${home.startups.length} submitted. You see only your own scores.` : "No startups are assigned to you yet."}</P>
      {home.startups.map((s) => (
        <Card key={s.startupId} onPress={() => open(s.startupId)} label={`Startup ${s.name}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <H2>{s.name}</H2>
            {s.evaluation ? <Badge text={STATE[s.evaluation.state]!.text} tone={STATE[s.evaluation.state]!.tone} /> : <Badge text="Not scored" />}
          </View>
          {s.city ? <P muted>{s.city}{s.state ? `, ${s.state}` : ""}</P> : null}
          {s.slot && (
            <P small>
              {s.slot.state === "pitching" ? "Pitching now" : s.slot.state === "done" ? "Pitched" : "Pitch"}
              {s.slot.startsAt ? ` · ${formatIst(s.slot.startsAt)} IST` : ""}{s.slot.venue ? ` · ${s.slot.venue}` : ""}
            </P>
          )}
        </Card>
      ))}
    </Screen>
  );
}
