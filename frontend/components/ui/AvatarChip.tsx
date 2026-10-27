// components/ui/AvatarChip.tsx
// Initials avatar, shared between the home feed and quotation submission.
// With `imageUri` (a profile picture), the photo replaces the initials.

import { View, Text, Image } from 'react-native';
import { color, font, fontSize, radius } from './tokens';

export function initials(name: string): string {
  const words = name.split(' ').filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

export function AvatarChip({ label, size = 32, dark = true, imageUri, round = false }: {
  label: string;
  size?: number;
  dark?: boolean;
  imageUri?: string | null;
  round?: boolean;
}) {
  const borderRadius = round ? size / 2 : size >= 40 ? radius.lg : radius.md;
  if (imageUri) {
    return <Image source={{ uri: imageUri }} style={{ width: size, height: size, borderRadius }} accessibilityLabel={label} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius,
        backgroundColor: dark ? color.ink : color.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: font.display, color: color.canvas, fontSize: size >= 80 ? fontSize.xl : size >= 40 ? fontSize.base : fontSize.sm }}>
        {label}
      </Text>
    </View>
  );
}
