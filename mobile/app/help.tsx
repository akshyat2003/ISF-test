// AI Help Desk in the app (FR-HD-01…20). Answers come only from official event information and the person's own
// records, selected and permission-checked on the server. The person can always ask a person (FR-HD-08), and an
// emergency is never left to the assistant: the server answers it with 112 first and alerts the support team.
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { formatIst } from "@sj/client";
import type { EmergencyResponse, HelpDeskMessage, HelpDeskReply } from "@sj/contracts";
import { Badge, Button, Field, Loading, Notice, P, Screen, colors } from "../components/ui";
import { telUrl } from "../lib/emergency";
import { messageOf, useSession } from "../lib/session";

export default function Help() {
  const { api } = useSession();
  const year = Number(useLocalSearchParams<{ year?: string }>().year ?? 2026);
  const [messages, setMessages] = useState<HelpDeskMessage[] | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [last, setLast] = useState<HelpDeskReply | null>(null);
  const [emergency, setEmergency] = useState<EmergencyResponse | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  useFocusEffect(useCallback(() => {
    api.helpdesk.conversation(year).then((c) => { setMessages(c.messages); setConversationId(c.conversationId ?? undefined); },
      (e) => { setMessages([]); setError(messageOf(e)); });
  }, [api, year]));

  function take(r: HelpDeskReply, question?: HelpDeskMessage) {
    setConversationId(r.conversationId);
    setLast(r);
    if (r.emergency) setEmergency(r.emergency);
    setMessages((m) => [...(m ?? []), ...(question ? [question] : []), r.message]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  }

  async function send() {
    const q = text.trim();
    if (!q) return;
    setBusy(true); setError(null);
    try {
      const r = await api.helpdesk.ask(year, q, conversationId);
      setText("");
      take(r, { id: `local-${Date.now()}`, role: "user", text: q, at: new Date().toISOString(), kind: null });
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  async function askPerson() {
    if (!conversationId) return;
    setBusy(true); setError(null);
    try { take(await api.helpdesk.askPerson(year, conversationId)); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  if (!messages) return <Screen><Loading /></Screen>;
  return (
    <Screen scroll={false}>
      {emergency && (
        <Notice kind="error">
          <View style={{ gap: 6 }}>
            {emergency.contacts.map((c) => (
              <Pressable key={c.phone} onPress={() => void Linking.openURL(telUrl(c.phone))} accessibilityRole="button" accessibilityLabel={`Call ${c.title}, ${c.phone}`}>
                <Text style={{ color: colors.danger, fontWeight: "800", fontSize: c.phone === "112" ? 20 : 15 }}>Call {c.phone} · {c.title}</Text>
              </Pressable>
            ))}
          </View>
        </Notice>
      )}
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <P muted>Ask about the programme, venues, food, accommodation, travel, or your own registration, assignment or requests. The assistant only uses the event team's published information and your own records. It may be wrong: check anything important with the event team.</P>
        )}
        {messages.map((m) => (
          <View key={m.id} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", gap: 2 }}>
            <View style={{ backgroundColor: m.role === "user" ? colors.accent : m.kind === "emergency" ? colors.dangerSoft : colors.card,
              borderWidth: m.role === "user" ? 0 : 1, borderColor: colors.line, borderRadius: 12, padding: 10 }}>
              <Text style={{ color: m.role === "user" ? "#fff" : colors.ink, fontSize: 15, lineHeight: 21 }}>{m.text}</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{formatIst(m.at)}</Text>
          </View>
        ))}
        {last && last.sources.length > 0 && (
          <P muted small>From: {last.sources.map((s) => `${s.section} · ${s.title}`).join("; ")}</P>
        )}
        {last && last.provider !== "vertex" && (
          <Badge text={last.provider === "stub" ? "Development stand-in, not an AI" : "Assistant not configured: basic answers only"} tone="warn" />
        )}
      </ScrollView>
      {error && <Notice kind="error">{error}</Notice>}
      <View style={{ gap: 8 }}>
        <Field label="Your question" value={text} onChangeText={setText} maxLength={1000} placeholder="For example: where is lunch on day 1?"
          onSubmitEditing={() => void send()} returnKeyType="send" />
        <Button title="Send" busy={busy} disabled={!text.trim()} onPress={() => void send()} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Ask a person" kind="secondary" disabled={!conversationId || busy || last?.canAskPerson === false} onPress={() => void askPerson()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="My requests" kind="secondary" onPress={() => router.push({ pathname: "/requests", params: { year: String(year) } })} />
          </View>
        </View>
      </View>
    </Screen>
  );
}
