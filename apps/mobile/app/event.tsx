// Event information for one edition (FR-EVT-01…13): the same published data as the website, plus what this person's
// roles may see. Server-driven: a schedule change in the console shows here without an app release (FR-EVT-02).
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { formatIst } from "@sj/client";
import type { EventInfo } from "@sj/contracts";
import { Badge, Button, Card, H1, H2, Loading, Notice, P, Screen, colors } from "../components/ui";
import { messageOf, useSession } from "../lib/session";

const MEAL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snacks: "Snacks", other: "Food" } as const;
const time = (b: { startTime?: string | null; endTime?: string | null }) => (b.startTime ? `${b.startTime}${b.endTime ? `–${b.endTime}` : ""}` : "Time to be announced");

export default function EventScreen() {
  const { api } = useSession();
  const year = Number(useLocalSearchParams<{ year?: string }>().year ?? 2026);
  const [e, setE] = useState<EventInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { setError(null); api.event(year).then(setE, (x) => setError(messageOf(x))); }, [api, year]));

  if (error) return <Screen><Notice kind="error">{error}</Notice></Screen>;
  if (!e) return <Screen><Loading /></Screen>;
  const call = (phone: string) => void Linking.openURL(`tel:${phone.replace(/[^+0-9]/g, "")}`);
  const texts = [
    { title: "Accommodation", items: e.accommodation }, { title: "Travel and transport", items: e.travel },
    { title: "Safety guidelines", items: e.safety }, { title: "More information", items: e.pages },
  ].filter((s) => s.items.length);

  return (
    <Screen>
      <H1>{e.edition.name}</H1>
      <P muted small>The programme is tentative and may change.{e.lastUpdated ? ` Last updated ${formatIst(e.lastUpdated)} IST.` : ""}</P>

      <Card>
        <H2>Emergency</H2>
        {e.emergency.map((c, i) => (
          <Pressable key={c.id ?? "112"} onPress={() => call(c.phone)} accessibilityRole="button" accessibilityLabel={`Call ${c.title}, ${c.phone}`}
            style={{ paddingVertical: 6 }}>
            <Text style={{ color: i === 0 ? colors.danger : colors.ink, fontWeight: i === 0 ? "700" : "600", fontSize: i === 0 ? 17 : 15 }}>
              {c.phone} · {c.title}
            </Text>
            {c.available ? <Text style={{ color: colors.muted, fontSize: 13 }}>{c.available}</Text> : null}
          </Pressable>
        ))}
      </Card>

      <H2>Programme</H2>
      {e.schedule.map((d) => (
        <Card key={d.date}>
          <Text style={{ fontWeight: "700", color: d.preEvent ? colors.accent : colors.ink, fontSize: 15 }} accessibilityRole="header">{d.label}</Text>
          {d.items.length === 0 && d.meals.length === 0 && <P muted small>Details to be announced.</P>}
          {d.items.map((i) => (
            <View key={i.id} style={{ paddingTop: 8, gap: 2 }}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{time(i.body)}{i.body.venue ? ` · ${i.body.venue}` : ""}</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Text style={{ fontWeight: "600", color: colors.ink, fontSize: 15, flexShrink: 1 }}>{i.title}</Text>
                {i.body.tentative ? <Badge text="Tentative" tone="warn" /> : null}
              </View>
              {i.body.details ? <P small muted>{i.body.details}</P> : null}
            </View>
          ))}
          {d.meals.map((m) => (
            <View key={m.id} style={{ paddingTop: 8, gap: 2 }}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{time(m.body)}{m.body.venue ? ` · ${m.body.venue}` : ""}</Text>
              <Text style={{ fontWeight: "600", color: colors.ink, fontSize: 15 }}>{MEAL[m.body.meal]}: {m.title}</Text>
              {m.body.menu.length ? <P small muted>{m.body.menu.join(" · ")}</P> : null}
            </View>
          ))}
        </Card>
      ))}

      {e.venues.length > 0 && <H2>Venues</H2>}
      {e.venues.map((v) => (
        <Card key={v.id}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: colors.ink }}>{v.title}</Text>
          {v.body.address ? <P>{v.body.address}</P> : null}
          {v.body.notes ? <P small muted>{v.body.notes}</P> : null}
          {v.body.mapUrl ? <Button title="Open map" kind="secondary" onPress={() => void Linking.openURL(v.body.mapUrl!)} /> : null}
        </Card>
      ))}

      {texts.map((s) => (
        <View key={s.title} style={{ gap: 10 }}>
          <H2>{s.title}</H2>
          {s.items.map((i) => (
            <Card key={i.id}>
              <Text style={{ fontWeight: "700", fontSize: 15, color: colors.ink }}>{i.title}</Text>
              <P>{i.body.text}</P>
              {i.body.address ? <P small muted>{i.body.address}</P> : null}
            </Card>
          ))}
        </View>
      ))}

      {e.documents.length > 0 && <H2>Documents</H2>}
      {docError ? <Notice kind="error">{docError}</Notice> : null}
      {e.documents.map((d) => (
        <Card key={d.id} label={`Open ${d.title}`} onPress={async () => {
          setDocError(null);
          try { await Linking.openURL(api.absoluteUrl((await api.documentLink(year, d.id)).url)); } catch (x) { setDocError(messageOf(x)); }
        }}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: colors.ink }}>{d.title}</Text>
          {d.description ? <P small muted>{d.description}</P> : null}
          <P small muted>{d.fileName} · tap to open</P>
        </Card>
      ))}
    </Screen>
  );
}
