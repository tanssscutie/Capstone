// components/ui/AvatarChip.tsx
// Initials avatar, shared between the home feed and quotation submission.

import { View, Text } from 'react-native';
import { color, font, fontSize, radius } from './tokens';

export function initials(name: string): string {
  const words = name.split(' ').filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

export function AvatarChip({ label, size = 32, dark = true }: { label: string; size?: number; dark?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size >= 40 ? radius.lg : radius.md,
        backgroundColor: dark ? color.ink : color.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: font.display, color: color.canvas, fontSize: size >= 40 ? fontSize.base : fontSize.sm }}>
        {label}
      </Text>
    </View>
  );
}
