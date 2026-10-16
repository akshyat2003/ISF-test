import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { normaliseMobile, type SignInIdentifier, type SignInMethod } from "@sj/contracts";
import { Button, Choice, Field, H1, Notice, P, Screen } from "../components/ui";
import { messageOf, useSession } from "../lib/session";

const LABEL: Record<SignInMethod, string> = { email: "Sign in with email", phone: "Sign in with mobile number" };

export default function SignIn() {
  const { startSignIn, verifyCode, authMode, signInMethods } = useSession();
  const [method, setMethod] = useState<SignInMethod>(signInMethods[0] ?? "email");
  const [value, setValue] = useState("");
  const [who, setWho] = useState<SignInIdentifier | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identifier = (): SignInIdentifier | null => {
    if (method === "email") return /^\S+@\S+\.\S+$/.test(value.trim()) ? { email: value.trim().toLowerCase() } : null;
    const phone = normaliseMobile(value);
    return phone ? { phone } : null;
  };

  async function go(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  return (
    <Screen>
      <H1>Startup Jathara</H1>
      <P muted>@ Dandakaranya · 18–20 December 2026 · GIET University, Gunupur</P>
      <P>Sign in with a one-time code. If the event team registered you, use the email or mobile number they hold for you.</P>
      {!who && signInMethods.length > 1 && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Sign in with">
          {signInMethods.map((m) => (
            <Choice key={m} label={LABEL[m]} selected={method === m} onPress={() => { setMethod(m); setValue(""); setError(null); }} />
          ))}
        </View>
      )}
      {!who ? (
        method === "email" ? (
          <Field label="Email" value={value} onChangeText={setValue} autoCapitalize="none" autoComplete="email" keyboardType="email-address"
            textContentType="emailAddress" returnKeyType="go" />
        ) : (
          <Field label="Mobile number" hint="Indian numbers: 10 digits. Others: +country code." value={value} onChangeText={setValue}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
        )
      ) : (
        <>
          <P>Enter the code sent to {"email" in who ? who.email : who.phone}.</P>
          <Field label={"email" in who ? "Code from your email" : "Code from the SMS"} value={code} onChangeText={setCode}
            keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
        </>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {!who ? (
        <Button title="Continue" busy={busy} disabled={!identifier()}
          onPress={() => void go(async () => {
            const id = identifier()!;
            const r = await startSignIn(id);
            if (r === "code_sent") setWho(id); else router.replace("/");
          })} />
      ) : (
        <>
          <Button title="Sign in" busy={busy} disabled={code.trim().length < 6}
            onPress={() => void go(async () => { await verifyCode(who, code); router.replace("/"); })} />
          <Button title="Use a different email or number" kind="secondary" onPress={() => { setWho(null); setCode(""); }} />
        </>
      )}
      {authMode === "dev" && <P muted small>Development sign-in: no code is sent. Use test data only.</P>}
    </Screen>
  );
}
