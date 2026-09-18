// components/ui/MobileNavMenu.tsx
// Primary nav (Home / My Quotations / My Requirements / Saved) collapsed into a
// dropdown for narrow screens — AppHeader.tsx hides the full nav row below
// breakpoint.desktop, and until this existed there was no fallback at all: a
// business on a phone-width screen had no way to reach any of those four pages
// from the header. Same anchored-dropdown mechanism as AccountDropdown.tsx
// (full-screen backdrop to dismiss, absolutely positioned menu below the
// trigger) so the two feel like one pattern.

import type { ComponentType } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, space, radius } from './tokens';

export interface MobileNavItem {
  label: string;
  href: string;
  Icon: ComponentType<{ tone: string }>;
  badge?: number;
}

export interface MobileNavMenuProps {
  items: MobileNavItem[];
  activeHref: string;
  onDismiss: () => void;
  /** Y-coordinate of the trigger's bottom edge in window space. */
  anchorTop: number;
  /** Left offset of the trigger in window space — the menu's left edge lines up with this. */
  anchorLeft: number;
}

export default function MobileNavMenu({ items, activeHref, onDismiss, anchorTop, anchorLeft }: MobileNavMenuProps) {
  const router = useRouter();

  const menuStyle: ViewStyle = {
    position: 'absolute',
    top: anchorTop + 6,
    left: anchorLeft,
    minWidth: 220,
    maxWidth: 280,
  };

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Close navigation menu" />

      <View style={menuStyle} pointerEvents="box-none">
        <View style={styles.menu}>
          {items.map((item) => {
            const active = item.href === activeHref;
            const tone = active ? color.ink : color.inkMuted;
            return (
              <Pressable
                key={item.label}
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                onPress={() => {
                  onDismiss();
                  router.push(item.href);
                }}
              >
                <View style={styles.menuItemIconWrap}>
                  <item.Icon tone={tone} />
                </View>
                <Text style={[styles.menuItemLabel, active ? styles.menuItemLabelActive : null]}>{item.label}</Text>
                {!!item.badge && (
                  <View style={styles.menuBadge}>
                    <Text style={styles.menuBadgeLabel}>{item.badge}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  menu: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    paddingVertical: space.xs,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 8px 24px rgba(15,15,14,0.12), 0 2px 4px rgba(15,15,14,0.06)' },
      default: { elevation: 12 },
    }),
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.md },
  menuItemPressed: { backgroundColor: color.surfaceSunken },
  menuItemIconWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  menuItemLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.inkMuted, flex: 1 },
  menuItemLabelActive: { fontFamily: font.bodySemi, color: color.ink },
  menuBadge: { minWidth: 18, height: 18, borderRadius: radius.pill, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  menuBadgeLabel: { fontFamily: font.mono, fontSize: 10, lineHeight: 11, color: color.onPrimary },
});
