import { Redirect } from "expo-router";
import { Button, Loading, Notice, Screen } from "../components/ui";
import { useSession } from "../lib/session";

/** Entry gate: signed out → sign in; awaiting activation → activate; otherwise the role-aware home. */
export default function Index() {
  const { signedIn, me, meError, refreshMe, signOut } = useSession();
  if (signedIn === undefined) return <Screen><Loading /></Screen>;
  if (!signedIn) return <Redirect href="/signin" />;
  if (meError) {
    return (
      <Screen>
        <Notice kind="error">{meError}</Notice>
        <Button title="Try again" onPress={() => void refreshMe()} />
        <Button title="Sign out" kind="secondary" onPress={() => void signOut()} />
      </Screen>
    );
  }
  if (!me) return <Screen><Loading /></Screen>;
  if (me.account?.status === "pending_activation") return <Redirect href="/activate" />;
  return <Redirect href="/home" />;
}
