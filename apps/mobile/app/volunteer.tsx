// Volunteer coordination for one edition (FR-VOL-12): a volunteer's own assignment with the target's contact, and the
// volunteer assigned to a startup leader's startup or to a jury member. Saved assignments only; drafts never show.
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Text } from "react-native";
import { formatIst } from "@sj/client";
import type { MyVolunteer, MyVolunteerAssignment } from "@sj/contracts";
import { Button, Card, H1, H2, Loading, Notice, P, Screen } from "../components/ui";
import { messageOf, useSession } from "../lib/session";

export default function Volunteer() {
  const { api, me } = useSession();
  const year = Number(useLocalSearchParams<{ year?: string }>().year ?? 2026);
  const [mine, setMine] = useState<MyVolunteerAssignment | null>(null);
  const [theirs, setTheirs] = useState<MyVolunteer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perms = me?.permissions ?? [];

  useFocusEffect(useCallback(() => {
    setError(null);
    void (async () => {
      try {
        setMine(perms.includes("volunteer.my_assignment") ? await api.volunteer.myAssignment(year) : null);
        setTheirs(perms.includes("volunteer.my_volunteer") ? await api.volunteer.myVolunteer(year) : null);
      } catch (e) { setError(messageOf(e)); } finally { setLoaded(true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, year, perms.join(",")]));

  if (error) return <Screen><Notice kind="error">{error}</Notice></Screen>;
  if (!loaded) return <Screen><Loading /></Screen>;
  const call = (m: string) => void Linking.openURL(`tel:${m}`);

  return (
    <Screen>
      <H1>Volunteer · {year}</H1>
      {mine && (
        mine.assignment ? (
          <Card>
            <H2>Your assignment</H2>
            <P>You are the volunteer for {mine.assignment.target.type === "startup" ? "the startup" : "the jury member"} <Text style={{ fontWeight: "700" }}>{mine.assignment.target.name}</Text>.</P>
            <P>Contact: {mine.assignment.target.contactName}{mine.assignment.target.mobile ? ` · ${mine.assignment.target.mobile}` : ""}</P>
            <P muted small>Since {formatIst(mine.assignment.since)} IST</P>
            {mine.assignment.target.mobile ? <Button title={`Call ${mine.assignment.target.contactName}`} kind="secondary" onPress={() => call(mine.assignment!.target.mobile!)} /> : null}
          </Card>
        ) : <Notice kind="warn">You do not have a volunteer assignment yet. You will get a message when Management assigns you.</Notice>
      )}
      {theirs && (
        theirs.volunteer ? (
          <Card>
            <H2>{theirs.volunteer.for === "startup" ? "Your startup's volunteer" : "Your volunteer"}</H2>
            <P>{theirs.volunteer.name}{theirs.volunteer.mobile ? ` · ${theirs.volunteer.mobile}` : ""}</P>
            {theirs.volunteer.mobile ? <Button title={`Call ${theirs.volunteer.name}`} kind="secondary" onPress={() => call(theirs.volunteer!.mobile!)} /> : null}
          </Card>
        ) : <Notice kind="warn">No volunteer has been assigned to you yet.</Notice>
      )}
      {!mine && !theirs && <P muted>Volunteer details are not available for your role.</P>}
    </Screen>
  );
}
