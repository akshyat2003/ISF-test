// My requests (FR-SUP-15): the person's own support tickets, their status and the support team's replies. Internal
// staff notes never reach this screen (the API does not send them).
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { formatIst } from "@sj/client";
import type { MyTicket } from "@sj/contracts";
import { Badge, Button, Card, Field, H2, Loading, Notice, P, Screen } from "../components/ui";
import { messageOf, useSession } from "../lib/session";

const KIND = { created: "You", status: "Status", reply: "Support team", requester_note: "You" } as const;

export default function Requests() {
  const { api } = useSession();
  const year = Number(useLocalSearchParams<{ year?: string }>().year ?? 2026);
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api.myTickets(year).then(setTickets, (e) => setError(messageOf(e))); }, [api, year]);
  useFocusEffect(load);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setError(null);
    try { await fn(); load(); } catch (e) { setError(messageOf(e)); } finally { setBusy(null); }
  }

  if (!tickets && !error) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      {error && <Notice kind="error">{error}</Notice>}
      <Card>
        <H2>New request</H2>
        <P muted small>For an emergency use the Emergency button instead: it shows 112 and alerts the team at once.</P>
        <Field label="What do you need help with?" value={subject} onChangeText={setSubject} maxLength={200} />
        <Field label="Details (optional)" value={description} onChangeText={setDescription} multiline maxLength={4000} />
        <Button title="Send request" busy={busy === "new"} disabled={!subject.trim()}
          onPress={() => void run("new", async () => { await api.createTicket(year, subject.trim(), description.trim() || undefined); setSubject(""); setDescription(""); })} />
      </Card>
      {tickets?.length === 0 && <P muted>You have no requests for {year}.</P>}
      {tickets?.map((t) => (
        <Card key={t.id}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Badge text={t.status} tone={t.status === "Resolved" ? "ok" : "warn"} />
            {t.isEmergency && <Badge text="Emergency" tone="warn" />}
            <Badge text={t.ref} />
          </View>
          <H2>{t.subject}</H2>
          {t.updates.map((u, i) => (
            <P key={i} small><P small muted>{formatIst(u.at)} · {KIND[u.kind]}: </P>{u.text}</P>
          ))}
          {t.status !== "Resolved" && (
            <View style={{ gap: 8 }}>
              <Field label="Add a message" value={notes[t.id] ?? ""} onChangeText={(v) => setNotes((n) => ({ ...n, [t.id]: v }))} maxLength={2000} />
              <Button title="Send message" kind="secondary" busy={busy === t.id} disabled={!(notes[t.id] ?? "").trim()}
                onPress={() => void run(t.id, async () => { await api.addTicketNote(t.id, notes[t.id]!.trim()); setNotes((n) => ({ ...n, [t.id]: "" })); })} />
            </View>
          )}
        </Card>
      ))}
    </Screen>
  );
}
