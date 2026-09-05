// components/ui/AdminSidebar.tsx
// Shared nav shell for the admin area — used by the dashboard, businesses,
// and requirements pages, so a new page one-lines into NAV_ITEMS below
// instead of hand-rolled per screen.
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { color, font, fontSize, space, radius } from './tokens';

export const ADMIN_NAV_ITEMS: { label: string; href: '/admin' | '/admin-businesses' | '/admin-requirements' }[] = [
  { label: 'Dashboard', href: '/admin' },
  { label: 'Businesses', href: '/admin-businesses' },
  { label: 'Requirements', href: '/admin-requirements' },
];

export function AdminSidebar({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <View style={styles.sidebar}>
      <View>
        <View style={styles.sidebarBrandRow}>
          <Image source={require('../../assets/logo.jpg')} style={styles.sidebarLogo} resizeMode="contain" />
          <View>
            <Text style={styles.sidebarEyebrow}>TrustLink</Text>
            <Text style={styles.sidebarTitle}>Admin</Text>
          </View>
        </View>
        <View style={styles.navSection}>
          {ADMIN_NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Pressable
                key={item.href}
                onPress={() => router.push(item.href)}
                style={[styles.navItem, active && styles.navItemActive]}
              >
                <View style={[styles.navItemBar, active && styles.navItemBarActive]} />
                <Text style={[styles.navItemLabel, active && styles.navItemLabelActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Pressable onPress={onLogout} style={styles.sidebarLogoutButton}>
        <Text style={styles.sidebarLogoutLabel}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 220,
    backgroundColor: color.surface,
    borderRightWidth: 1,
    borderRightColor: color.border,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    justifyContent: 'space-between',
  },
  sidebarBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xxl,
  },
  sidebarLogo: {
    width: 32,
    height: 32,
  },
  sidebarEyebrow: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    color: color.inkMuted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  sidebarTitle: {
    fontFamily: font.display,
    fontSize: fontSize.lg,
    color: color.ink,
  },
  navSection: {
    gap: space.xs,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
  },
  navItemActive: {
    backgroundColor: color.primaryFaint,
  },
  navItemBar: {
    width: 3,
    height: 16,
    borderRadius: 2,
    backgroundColor: 'transparent',
    marginRight: space.sm,
  },
  navItemBarActive: {
    backgroundColor: color.primary,
  },
  navItemLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },
  navItemLabelActive: {
    fontFamily: font.bodySemi,
    color: color.primary,
  },
  sidebarLogoutButton: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  sidebarLogoutLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.ink,
  },
});
