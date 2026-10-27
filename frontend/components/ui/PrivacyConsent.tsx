// components/ui/PrivacyConsent.tsx
// The RA 10173 consent box — register form and complete-profile. Opens the
// notice in a new tab on web so a half-filled form isn't lost.
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, lineHeight, space, radius } from './tokens';

export function PrivacyConsent({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  const router = useRouter();

  const openNotice = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open('/privacy', '_blank', 'noopener');
    else router.push('/privacy');
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I agree to the Privacy Notice"
        hitSlop={6}
        style={[styles.box, checked ? styles.boxChecked : null]}
      >
        {checked && <Text style={styles.tick}>✓</Text>}
      </Pressable>
      <Text style={styles.text}>
        I have read and agree to the{' '}
        <Text style={styles.link} onPress={openNotice} accessibilityRole="link">Privacy Notice</Text>, and I consent to
        TrustLink processing my business and personal information as described there, under the Data Privacy Act of 2012.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginTop: space.md, marginBottom: space.sm },
  box: { width: 20, height: 20, marginTop: 1, borderRadius: radius.sm, borderWidth: 1.5, borderColor: color.borderStrong, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  boxChecked: { backgroundColor: color.primary, borderColor: color.primary },
  tick: { fontFamily: font.bodySemi, fontSize: 13, lineHeight: 15, color: color.onPrimary },
  text: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  link: { fontFamily: font.bodySemi, color: color.primary, textDecorationLine: 'underline' },
});
