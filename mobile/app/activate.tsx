import { router } from "expo-router";
import { useState } from "react";
import { Button, Field, H1, Notice, P, Screen } from "../components/ui";
import { messageOf, useSession } from "../lib/session";

/** Imported participants activate with the single-use code from the event team (FR-IAM-08/10). */
export default function Activate() {
  const { api, me, refreshMe, signOut } = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me?.account?.status === "active") {
    return (
      <Screen>
        <Notice kind="ok">Your account is active.</Notice>
        <Button title="Continue" onPress={() => router.replace("/home")} />
      </Screen>
    );
  }
  return (
    <Screen>
      <H1>Activate your account</H1>
      <P>Signed in as {me?.account?.email ?? me?.account?.mobile ?? "you"}. Enter the activation code you received from the event team.</P>
      <Field label="Activation code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false}
        autoComplete="one-time-code" textContentType="oneTimeCode" />
      {error && <Notice kind="error">{error}</Notice>}
      <Button title="Activate" busy={busy} disabled={code.trim().length < 20}
        onPress={() => void (async () => {
          setBusy(true); setError(null);
          try { await api.activate(code.trim()); await refreshMe(); router.replace("/home"); }
          catch (e) { setError(messageOf(e)); }
          finally { setBusy(false); }
        })()} />
      <P muted small>The code works once and expires. If it does not work, ask the event team for a new one.</P>
      <Button title="Sign out" kind="secondary" onPress={() => void signOut().then(() => router.replace("/signin"))} />
    </Screen>
  );
}
