import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { formatDateRange } from "@sj/client";
import type { MyApplicationsResponse, PublicEdition } from "@sj/contracts";
import { Badge, Button, Card, H1, H2, Loading, Notice, P, Screen, colors } from "../components/ui";
import { ROLE_LABEL, STAFF_ROLES, STATUS_LABEL, STATUS_TONE } from "../lib/labels";
import { messageOf, useSession } from "../lib/session";

/** Role-aware home. What each person sees follows their roles and edition access; the API enforces both. */
export default function Home() {
  const { api, me, refreshMe, signOut } = useSession();
  const [apps, setApps] = useState<MyApplicationsResponse | null>(null);
  const [editions, setEditions] = useState<PublicEdition[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let live = true;
    void (async () => {
      try {
        const m = await refreshMe();
        if (m?.account?.status === "pending_activation") { router.replace("/activate"); return; }
        const [a, e, n] = await Promise.all([api.myApplications(), api.editions(), api.myNotifications()]);
        if (!live) return;
        setApps(a); setEditions(e); setUnread(n.filter((x) => !x.readAt).length);
      } catch (e) { if (live) setError(messageOf(e)); }
    })();
    return () => { live = false; };
  }, [api, refreshMe]));

  if (error) return <Screen><Notice kind="error">{error}</Notice><Button title="Sign out" kind="secondary" onPress={() => void signOut().then(() => router.replace("/signin"))} /></Screen>;
  if (!me || !apps) return <Screen><Loading /></Screen>;

  const name = me.account?.fullName?.split(" ")[0];
  const roles = me.roles;
  const staffOnly = roles.length > 0 && roles.every((r) => STAFF_ROLES.includes(r));
  const openEditions = editions.filter((e) => e.registration.open);
  const canApply = !roles.some((r) => r === "startup_team_member" || r === "jury_member" || r === "volunteer" || r === "delegate")
    && openEditions.some((e) => !apps.applications.some((a) => a.edition === e.year))
    && !(apps.startup && apps.applications.length === 0 && me.editionAccess.length > 0);   // predefined startups do not apply

  return (
    <Screen>
      <Button title="Emergency: call 112 or alert the event team" onPress={() => router.push(me.editionAccess[0] ? { pathname: "/emergency", params: { year: String(me.editionAccess[0]) } } : "/emergency")} />
      <H1>{name ? `Hello, ${name}` : "Welcome"}</H1>
      {roles.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {roles.map((r) => <Badge key={r} text={ROLE_LABEL[r]} tone="ok" />)}
        </View>
      )}

      {me.editionAccess.map((year) => {
        const e = editions.find((x) => x.year === year);
        return (
          <Card key={year}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.accent, letterSpacing: 1 }}>YOUR EVENT</Text>
            <H2>Startup Jathara {year}</H2>
            {e?.eventStartsOn && e.eventEndsOn ? <P>{formatDateRange(e.eventStartsOn, e.eventEndsOn)} · GIET University, Gunupur</P> : <P muted>Dates to be announced.</P>}
            {apps.startup && <P>Startup: <Text style={{ fontWeight: "700" }}>{apps.startup.name}</Text></P>}
            <P muted small>Schedule, venues, food, accommodation, safety and emergency contacts, as the event team publishes them. Notices arrive in Messages.</P>
            <Button title="Programme and event information" onPress={() => router.push({ pathname: "/event", params: { year: String(year) } })} />
            {me.permissions.includes("helpdesk.use") && (
              <Button title="Help: ask a question" kind="secondary" onPress={() => router.push({ pathname: "/help", params: { year: String(year) } })} />
            )}
            {me.permissions.includes("support.request_own") && (
              <Button title="My requests" kind="secondary" onPress={() => router.push({ pathname: "/requests", params: { year: String(year) } })} />
            )}
            {me.permissions.includes("jury.evaluate") && (
              <Button title={`Jury: score your startups (${year})`} onPress={() => router.push({ pathname: "/jury", params: { year: String(year) } })} />
            )}
            {(me.permissions.includes("volunteer.my_assignment") || me.permissions.includes("volunteer.my_volunteer")) && (
              <Button title={me.permissions.includes("volunteer.my_assignment") ? "My volunteer assignment" : "My volunteer"} kind="secondary"
                onPress={() => router.push({ pathname: "/volunteer", params: { year: String(year) } })} />
            )}
          </Card>
        );
      })}

      {staffOnly && <Notice kind="warn">Administration, management and support work is done in the web console. This app is for event participants.</Notice>}

      {apps.applications.length > 0 && (
        <Card onPress={() => router.push("/status")} label="Application status">
          <H2>Applications</H2>
          {apps.applications.map((a) => (
            <View key={a.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <P>{apps.startup?.name} · {a.edition}</P>
              <Badge text={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} />
            </View>
          ))}
        </Card>
      )}

      {canApply && (
        <Card onPress={() => router.push("/register")} label="Register a startup">
          <H2>{apps.applications.length ? "Apply for another year" : "Register a new startup"}</H2>
          <P muted>Apply for {openEditions.map((e) => e.year).join(" or ")}. Management reviews every application.</P>
        </Card>
      )}

      <Card onPress={() => router.push("/notifications")} label="Messages">
        <H2>Messages</H2>
        <P muted>{unread ? `${unread} unread` : "No unread messages"}</P>
      </Card>

      {!me.account && apps.applications.length === 0 && !canApply && (
        <Notice kind="warn">Registration is closed and no account is linked to this sign-in. If the event team registered you, sign in with the email they hold for you.</Notice>
      )}

      <Button title="Sign out" kind="secondary" onPress={() => void signOut().then(() => router.replace("/signin"))} />
    </Screen>
  );
}
