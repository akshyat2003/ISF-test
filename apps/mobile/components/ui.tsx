// Small design system for the app, matching the website and console palette (Dandakaranya forest green).
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export const colors = {
  ink: "#15191f", muted: "#5a6370", line: "#e2e5e9", bg: "#fafaf7", card: "#ffffff",
  accent: "#1d5a47", accentSoft: "#e6efeb", warn: "#8a5a00", warnSoft: "#fbf3e2", danger: "#a1271b", dangerSoft: "#fbeceb",
};

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={s.safe} edges={["bottom", "left", "right"]}>
      {scroll ? <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={s.content}>{children}</View>}
    </SafeAreaView>
  );
}

export const H1 = ({ children }: { children: ReactNode }) => <Text style={s.h1} accessibilityRole="header">{children}</Text>;
export const H2 = ({ children }: { children: ReactNode }) => <Text style={s.h2} accessibilityRole="header">{children}</Text>;
export const P = ({ children, muted, small }: { children: ReactNode; muted?: boolean; small?: boolean }) =>
  <Text style={[s.p, muted && { color: colors.muted }, small && { fontSize: 13 }]}>{children}</Text>;

export function Card({ children, onPress, label }: { children: ReactNode; onPress?: () => void; label?: string }) {
  if (!onPress) return <View style={s.card}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.card, pressed && { borderColor: colors.accent }]}>
      {children}
    </Pressable>
  );
}

export function Button({ title, onPress, kind = "primary", disabled, busy }:
  { title: string; onPress: () => void; kind?: "primary" | "secondary"; disabled?: boolean; busy?: boolean }) {
  const primary = kind === "primary";
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [s.btn, primary ? s.btnPrimary : s.btnSecondary, (disabled || busy) && { opacity: 0.55 }, pressed && { opacity: 0.85 }]}>
      {busy ? <ActivityIndicator color={primary ? "#fff" : colors.ink} /> : <Text style={[s.btnText, primary && { color: "#fff" }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <TextInput accessibilityLabel={label} placeholderTextColor="#9aa1aa" {...input}
        style={[s.input, input.multiline && { minHeight: 110, textAlignVertical: "top" }, error && { borderColor: colors.danger }]} />
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Choice({ label, selected, onPress, disabled, note }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean; note?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: !!disabled }} style={[s.choice, disabled && { opacity: 0.5 }]}>
      <View style={[s.radio, selected && s.radioOn]} />
      <Text style={{ flex: 1, color: colors.ink }}>{label}{note ? <Text style={s.hint}> — {note}</Text> : null}</Text>
    </Pressable>
  );
}

export function Check({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <Pressable onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} style={s.choice}>
      <View style={[s.box, checked && s.boxOn]}>{checked ? <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>✓</Text> : null}</View>
      <View style={{ flex: 1 }}>{children ?? <Text>{label}</Text>}</View>
    </Pressable>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "warn" | "error"; children: ReactNode }) {
  const c = { ok: [colors.accentSoft, colors.accent], warn: [colors.warnSoft, colors.warn], error: [colors.dangerSoft, colors.danger] }[kind];
  return (
    <View style={[s.notice, { backgroundColor: c[0], borderColor: c[1] + "55" }]} accessibilityRole={kind === "error" ? "alert" : undefined}>
      {typeof children === "string" ? <Text style={{ color: c[1] }}>{children}</Text> : children}
    </View>
  );
}

export function Badge({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "ok" | "warn" }) {
  const c = tone === "ok" ? [colors.accentSoft, colors.accent] : tone === "warn" ? [colors.warnSoft, colors.warn] : ["#f3f4f6", colors.muted];
  return <View style={[s.badge, { backgroundColor: c[0] }]}><Text style={{ color: c[1], fontWeight: "700", fontSize: 12 }}>{text}</Text></View>;
}

export const Loading = () => <View style={{ padding: 32 }}><ActivityIndicator color={colors.accent} /></View>;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  h1: { fontSize: 26, fontWeight: "700", color: colors.ink, letterSpacing: -0.3 },
  h2: { fontSize: 18, fontWeight: "700", color: colors.ink, marginTop: 8 },
  p: { fontSize: 15, lineHeight: 22, color: colors.ink },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16, gap: 6 },
  btn: { borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center", borderWidth: 1, minHeight: 48, justifyContent: "center" },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnSecondary: { backgroundColor: colors.card, borderColor: colors.line },
  btnText: { fontSize: 16, fontWeight: "600", color: colors.ink },
  label: { fontSize: 15, fontWeight: "600", color: colors.ink },
  hint: { fontSize: 13, color: colors.muted },
  input: { borderWidth: 1, borderColor: "#cfd4da", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, backgroundColor: "#fff", color: colors.ink },
  fieldError: { color: colors.danger, fontSize: 13 },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#9aa1aa" },
  radioOn: { borderColor: colors.accent, borderWidth: 6 },
  box: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: "#9aa1aa", alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  notice: { borderWidth: 1, borderRadius: 10, padding: 12 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
});
