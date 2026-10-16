// Emergency (FR-HD-10/11, TBD-07, TBD-55). Reachable from every screen's header, signed in or not, online or not.
// 112 is the first thing on the screen and is dialled by the phone itself: nothing is awaited before it can be
// pressed. Alerting the event team is a separate, explicit tap that never delays or replaces calling 112.
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { ApiError } from "@sj/client";
import type { EmergencyContact, EmergencyResponse } from "@sj/contracts";
import { Button, Card, Field, H2, Notice, P, Screen, colors } from "../components/ui";
import { decodeCache, encodeCache, newRequestId, telUrl, withNational, withRetries } from "../lib/emergency";
import { useSession } from "../lib/session";
import { secureStorage } from "../lib/storage";

const cacheKey = (year: number) => `sj.emergency.contacts.${year}`;

export default function Emergency() {
  const { api, signedIn, me } = useSession();
  const param = useLocalSearchParams<{ year?: string }>().year;
  // The person's own event; 2026 when they have none (the endpoint then returns the contacts without a ticket).
  const year = Number(param ?? me?.editionAccess[0] ?? 2026);
  const [contacts, setContacts] = useState<EmergencyContact[]>(withNational([]));
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [result, setResult] = useState<EmergencyResponse | null>(null);
  const requestId = useRef(newRequestId());   // one id per report: retries of it never open a second ticket

  // Published contacts from the last successful load, so they show offline too. 112 never depends on this.
  useEffect(() => {
    let live = true;
    void secureStorage.get(cacheKey(year)).then((raw) => { if (live) setContacts((c) => withNational([...c.slice(1), ...decodeCache(raw)])); }, () => {});
    if (signedIn) {
      void api.event(year).then((e) => {
        if (!live) return;
        setContacts(withNational(e.emergency));
        void secureStorage.set(cacheKey(year), encodeCache(e.emergency)).catch(() => {});
      }, () => {});
    }
    return () => { live = false; };
  }, [api, year, signedIn]);

  const call = (phone: string) => void Linking.openURL(telUrl(phone)).catch(() => {});

  async function alertTeam() {
    setState("sending");
    const r = await withRetries(() => api.reportEmergency(year, requestId.current, message.trim() || undefined),
      { retryable: (e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) });
    if (r.ok) {
      setResult(r.value);
      setContacts(withNational(r.value.contacts));
      setState(r.value.ticket ? "sent" : "failed");
      requestId.current = newRequestId();   // a later report is a new report (the API adds it to the open ticket)
    } else {
      setState("failed");
    }
  }

  return (
    <Screen>
      <Pressable onPress={() => call("112")} accessibilityRole="button" accessibilityLabel="Call 112, national emergency number"
        style={({ pressed }) => [{ backgroundColor: colors.danger, borderRadius: 14, paddingVertical: 22, alignItems: "center", gap: 4 }, pressed && { opacity: 0.85 }]}>
        <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800" }}>Call 112</Text>
        <Text style={{ color: "#fff", fontSize: 14 }}>Police, fire, ambulance · India</Text>
      </Pressable>
      <P>If anyone is in danger or needs urgent medical help, call 112 first. Do not wait for the event team.</P>

      {contacts.length > 1 && (
        <Card>
          <H2>Event emergency contacts</H2>
          {contacts.slice(1).map((c) => (
            <Pressable key={c.phone} onPress={() => call(c.phone)} accessibilityRole="button" accessibilityLabel={`Call ${c.title}, ${c.phone}`} style={{ paddingVertical: 6 }}>
              <Text style={{ fontWeight: "700", color: colors.ink, fontSize: 16 }}>{c.phone}</Text>
              <Text style={{ color: colors.ink }}>{c.title}</Text>
              {c.available ? <Text style={{ color: colors.muted, fontSize: 13 }}>{c.available}</Text> : null}
            </Pressable>
          ))}
        </Card>
      )}

      <Card>
        <H2>Alert the event support team</H2>
        {!signedIn ? (
          <P muted>Sign in to alert the event support team from the app. Calling 112 does not need sign-in.</P>
        ) : state === "sent" && result?.ticket ? (
          <View style={{ gap: 8 }}>
            <Notice kind="ok">
              {result.reportedAgain
                ? `Added to your open emergency ${result.ticket.ref}. The support team has been alerted again.`
                : `Emergency ${result.ticket.ref} raised. ${result.alerted ? "The support team has been alerted." : ""}`}
            </Notice>
            <P muted small>Follow it under My requests. If the situation gets worse, call 112.</P>
            <Button title="Send another update" kind="secondary" onPress={() => { setState("idle"); setMessage(""); }} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Field label="What is happening and where? (optional)" value={message} onChangeText={setMessage} multiline maxLength={1000}
              placeholder="For example: someone fainted near the main stage" />
            {state === "failed" && (
              <Notice kind="error">
                {result && !result.ticket
                  ? "The alert could not be recorded for this event. Call 112 or the numbers above."
                  : "The alert could not be sent (no connection). Call 112 or the numbers above. You can try sending again."}
              </Notice>
            )}
            <Button title={state === "failed" ? "Try sending the alert again" : "Alert the support team"} busy={state === "sending"} onPress={() => void alertTeam()} />
          </View>
        )}
      </Card>
    </Screen>
  );
}
