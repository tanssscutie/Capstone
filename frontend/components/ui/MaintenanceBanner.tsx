// components/ui/MaintenanceBanner.tsx
// The maintenance notice a super admin sets under Platform rules
// (GET /meta/banner), shown under the app header on every signed-in page.
// Nothing renders when it's empty or can't be loaded.
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, space } from './tokens';
import { getMaintenanceBanner } from '../../lib/api/meta';

export function MaintenanceBanner() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    getMaintenanceBanner().then((m) => { if (live) setMessage(m); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!message) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: color.warningFaint, borderBottomWidth: 1, borderBottomColor: color.warningBorder, paddingHorizontal: space.lg, paddingVertical: space.sm },
  text: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink, textAlign: 'center' },
});
