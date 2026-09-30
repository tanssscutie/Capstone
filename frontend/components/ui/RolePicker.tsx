// components/ui/RolePicker.tsx
// Buyer-or-seller choice, shown once at sign-up (register form, or
// complete-profile for a Google sign-up). The account type can't be changed
// afterward, so each option spells out what it lets you do.
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, space, radius } from './tokens';
import type { AccountRole } from '../../lib/types';

const OPTIONS: { value: AccountRole; title: string; blurb: string }[] = [
  { value: 'buyer', title: "I'm a buyer", blurb: 'Post requirements and award the best quotation.' },
  { value: 'seller', title: "I'm a seller", blurb: 'Find open requirements and submit quotations.' },
];

export function RolePicker({ value, onChange }: { value: AccountRole | null; onChange: (role: AccountRole) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Account type</Text>
      <View style={styles.row}>
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={[styles.option, active && styles.optionActive]}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
            >
              <Text style={[styles.title, active && styles.titleActive]}>{opt.title}</Text>
              <Text style={styles.blurb}>{opt.blurb}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>This can't be changed later.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: space.lg },
  label: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink, marginBottom: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  option: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space.md,
    backgroundColor: color.canvas,
  },
  optionActive: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  title: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  titleActive: { color: color.primary },
  blurb: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, marginTop: space.xs },
  hint: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint, marginTop: space.xs },
});
