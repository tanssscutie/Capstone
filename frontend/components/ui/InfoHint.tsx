// components/ui/InfoHint.tsx
// Progressive disclosure for explanations: a small "ⓘ More info" that shows
// the text only when asked. Used to keep forms and detail screens short for a
// new user without deleting any of the explanation — it's one tap away.
// Errors are never hidden behind this.
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { color, font, fontSize, lineHeight, space, radius } from './tokens';

/** Captions at or under this length stay visible as-is (see CaptionOrHint). */
export const SHORT_CAPTION_MAX = 70;

export function InfoHint({ text, label = 'More info' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen((v) => !v)} hitSlop={6} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.toggle}>{open ? `ⓘ Hide` : `ⓘ ${label}`}</Text>
      </Pressable>
      {open && (
        <View style={styles.box}>
          <Text style={styles.text}>{text}</Text>
        </View>
      )}
    </View>
  );
}

/** A short caption shows as plain text; a long one hides behind InfoHint. */
export function CaptionOrHint({ text, style }: { text: string; style?: object }) {
  if (text.length <= SHORT_CAPTION_MAX) return <Text style={[styles.text, style]}>{text}</Text>;
  return <InfoHint text={text} />;
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, marginTop: space.xs },
  toggle: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  box: { borderLeftWidth: 2, borderLeftColor: color.primaryBorder, backgroundColor: color.primaryFaint, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  text: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
});
