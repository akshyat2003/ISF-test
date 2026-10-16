import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { formatIst } from "@sj/client";
import type { NotificationItem } from "@sj/contracts";
import { Badge, Card, H2, Loading, Notice, P, Screen } from "../components/ui";
import { messageOf, useSession } from "../lib/session";

export default function Notifications() {
  const { api } = useSession();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { api.myNotifications().then(setItems, (e) => setError(messageOf(e))); }, [api]));

  if (error) return <Screen><Notice kind="error">{error}</Notice></Screen>;
  if (!items) return <Screen><Loading /></Screen>;
  if (items.length === 0) return <Screen><P muted>No messages yet.</P></Screen>;
  return (
    <Screen>
      {items.map((n) => (
        <Card key={n.id} label={n.title} onPress={n.readAt ? undefined : () => {
          void api.markRead(n.id).then(() => setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null), () => {});
        }}>
          {!n.readAt && <Badge text={n.kind === "notice" ? "New notice" : "New"} tone="ok" />}
          {n.readAt && n.kind === "notice" && <Badge text="Notice" />}
          <H2>{n.title}</H2>
          <P>{n.body}</P>
          <P muted small>{formatIst(n.createdAt)} IST</P>
        </Card>
      ))}
    </Screen>
  );
}
