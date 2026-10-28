// components/ui/BusinessLink.tsx
// Makes a business's name or avatar open its public profile
// (/business-profile?id=N) — used wherever a business is named: the feed,
// requirement detail, quotation lists after release, messages, saved, admin.
// Self-contained like ReportLink, so a screen just wraps what it already shows.
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, Platform, Text, StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { color } from './tokens';

type Id = string | number | null | undefined;

export function useOpenBusinessProfile(): (businessId: Id) => void {
  const router = useRouter();
  return (businessId) => {
    if (businessId == null || businessId === '') return;
    router.push({ pathname: '/business-profile', params: { id: String(businessId) } });
  };
}

/** Wraps an avatar (or anything) so pressing it opens the business's profile.
 *  With no id, renders the children as they are. */
export function BusinessLink({
  businessId,
  name,
  children,
  style,
}: {
  businessId: Id;
  /** For the accessibility label: "View <name>'s profile". */
  name: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const open = useOpenBusinessProfile();
  if (businessId == null || businessId === '') return <>{children}</>;
  return (
    <Pressable
      onPress={() => open(businessId)}
      accessibilityRole="link"
      accessibilityLabel={`View ${name}'s profile`}
      hitSlop={4}
      style={style}
    >
      {children}
    </Pressable>
  );
}

/** A business name that opens its profile — underlined on hover (web). */
export function BusinessNameLink({
  businessId,
  name,
  style,
  numberOfLines,
  inline,
}: {
  businessId: Id;
  name: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Inside a sentence ("Buyer · Pasig · ₱5,000"): a pressable nested Text
   *  instead of a Pressable, so it flows with the line. */
  inline?: boolean;
}) {
  const open = useOpenBusinessProfile();
  const [hovered, setHovered] = useState(false);
  if (businessId == null || businessId === '') {
    return <Text style={style} numberOfLines={numberOfLines}>{name}</Text>;
  }
  if (inline) {
    return (
      <Text
        onPress={() => open(businessId)}
        accessibilityRole="link"
        style={[style, styles.inline, hovered && styles.hovered]}
        {...(Platform.OS === 'web' ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) } as object : {})}
      >
        {name}
      </Text>
    );
  }
  return (
    <Pressable
      onPress={() => open(businessId)}
      accessibilityRole="link"
      accessibilityLabel={`View ${name}'s profile`}
      hitSlop={4}
      style={styles.press}
      {...(Platform.OS === 'web' ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } : {})}
    >
      <Text style={[style, hovered && styles.hovered]} numberOfLines={numberOfLines}>{name}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { flexShrink: 1, minWidth: 0 },
  hovered: { textDecorationLine: 'underline', color: color.primary },
  inline: { textDecorationLine: 'underline', textDecorationColor: color.borderStrong } as TextStyle,
});
