// components/ui/AccountDropdown.tsx
// Account menu anchored to the header's profile chip. Pure React Native —
// no portal, no Popover dep. A full-screen Pressable backdrop catches the
// outside-tap to dismiss, and the menu itself is positioned absolutely
// below the chip (passed in via `anchorTop`).

import { View, Text, Pressable, StyleSheet, Platform, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, fontSize, space, radius, elevation } from './tokens';
import { logout } from '../../lib/api/auth';

export interface AccountDropdownProps {
  onDismiss: () => void;
  /** Y-coordinate of the chip's top edge in window space, used to anchor
   *  the menu just below it. */
  anchorTop: number;
  /** Right offset of the chip in window space — the menu's right edge lines
   *  up with this. */
  anchorRight: number;
}

interface MenuItem {
  label: string;
  description?: string;
  onPress: () => void;
  destructive?: boolean;
}

export default function AccountDropdown({ onDismiss, anchorTop, anchorRight }: AccountDropdownProps) {
  const router = useRouter();

  const handleLogout = () => {
    onDismiss();
    logout();
    router.replace('/login');
  };

  const items: MenuItem[] = [
    {
      label: 'My Profile',
      description: 'Business name, contact, capabilities',
      onPress: () => {
        onDismiss();
        router.push('/account');
      },
    },
    {
      label: 'Account Settings',
      description: 'Notifications, mobile number, password',
      onPress: () => {
        onDismiss();
        router.push('/settings');
      },
    },
    {
      label: 'Help & Support',
      description: 'FAQ and how to reach us',
      onPress: () => {
        onDismiss();
        router.push('/help');
      },
    },
  ];

  const menuStyle: ViewStyle = {
    position: 'absolute',
    top: anchorTop + 6,
    right: anchorRight,
    minWidth: 260,
    maxWidth: 320,
  };

  return (
    <>
      {/* Backdrop to dismiss on outside tap. Sits below the menu in z-order
          but above the rest of the app. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityLabel="Close account menu"
      />

      <View style={menuStyle} pointerEvents="box-none">
        <View style={styles.menu}>
          {items.map((item) => (
            <Pressable
              key={item.label}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={item.onPress}
            >
              <Text style={styles.menuItemLabel}>{item.label}</Text>
              {!!item.description && (
                <Text style={styles.menuItemDescription} numberOfLines={1}>
                  {item.description}
                </Text>
              )}
            </Pressable>
          ))}

          <View style={styles.menuDivider} />

          <Pressable
            style={({ pressed }) => [
              styles.menuItem,
              pressed && styles.menuItemPressed,
            ]}
            onPress={handleLogout}
          >
            <Text style={[styles.menuItemLabel, styles.menuItemDestructive]}>Log out</Text>
            <Text style={styles.menuItemDescription} numberOfLines={1}>
              Sign out of this device
            </Text>
          </Pressable>
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
      web: {
        boxShadow: '0 8px 24px rgba(15,15,14,0.12), 0 2px 4px rgba(15,15,14,0.06)',
      },
      default: {
        elevation: 12,
      },
    }),
  },
  menuHeader: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: 2,
  },
  menuHeaderName: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.base,
    color: color.ink,
  },
  menuHeaderSub: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },
  menuDivider: {
    height: 1,
    backgroundColor: color.borderFaint,
  },
  menuItem: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: 2,
  },
  menuItemPressed: {
    backgroundColor: color.surfaceSunken,
  },
  menuItemLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.base,
    color: color.ink,
  },
  menuItemDescription: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },
  menuItemDestructive: {
    color: color.danger,
  },
});
