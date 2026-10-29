// app/+not-found.tsx
// Any URL that isn't a page. Deliberately lists nothing — Expo Router's
// default screen links to a sitemap of every route, which would show where
// the admin console lives (lib/adminRoutes.ts).
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, lineHeight, space, radius } from '../components/ui/tokens';

export default function NotFound() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <Text style={styles.code}>404</Text>
      <Text style={styles.title}>Page not found</Text>
      <Text style={styles.body}>The link may be mistyped, or the page no longer exists.</Text>
      <Pressable onPress={() => router.replace('/')} style={styles.button} accessibilityRole="link">
        <Text style={styles.buttonLabel}>Go to TrustLink</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl, backgroundColor: color.canvas },
  code: { fontFamily: font.monoMedium, fontSize: fontSize.sm, color: color.inkFaint },
  title: { fontFamily: font.display, fontSize: fontSize.xl, lineHeight: lineHeight.xl, color: color.ink },
  body: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted, textAlign: 'center' },
  button: { marginTop: space.md, backgroundColor: color.primary, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  buttonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },
});
