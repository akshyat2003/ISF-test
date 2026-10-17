import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "./ui";

const LOGOS = [
  {
    id: "giet",
    name: "GIET University",
    source: require("../assets/logos/giet.jpg"),
  },
  {
    id: "isf",
    name: "International Startup Foundation",
    source: require("../assets/logos/isf.jpg"),
  },
  {
    id: "incubatex",
    name: "Incubatex Innovation",
    source: require("../assets/logos/incubatex.jpg"),
  },
] as const;

export function OrganizerLogos({
  title = "Organized & Presented by",
  compact = false,
}: {
  title?: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.row}>
        {LOGOS.map((item) => (
          <View key={item.id} style={[styles.logoWrapper, compact && styles.logoWrapperCompact]}>
            <Image
              source={item.source}
              style={compact ? styles.logoCompact : styles.logo}
              resizeMode="contain"
              accessibilityLabel={item.name}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const UDBHAV_LOGO = require("../assets/udbhav-logo.png");

export function UdbhavEmblem({
  size = 96,
  showTitle = true,
  subtitle = "Innovation & Excellence · ISF · GIET University",
}: {
  size?: number;
  showTitle?: boolean;
  subtitle?: string;
}) {
  return (
    <View style={styles.emblemContainer}>
      <Image
        source={UDBHAV_LOGO}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="Udbhav Emblem"
      />
      {showTitle && <Text style={styles.emblemTitle}>Udbhav</Text>}
      {subtitle ? <Text style={styles.emblemSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emblemContainer: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  emblemTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.ink,
    letterSpacing: -0.5,
  },
  emblemSubtitle: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  container: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    alignItems: "center",
    gap: 12,
  },
  compactContainer: {
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 4,
    gap: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  logoWrapper: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 6,
    borderWidth: 1,
    borderColor: "#eaedf1",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  logoWrapperCompact: {
    padding: 4,
    borderRadius: 8,
  },
  logo: {
    width: 68,
    height: 68,
  },
  logoCompact: {
    width: 44,
    height: 44,
  },
});
