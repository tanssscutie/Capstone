// features/messages/Messages.tsx
// Full-page Messages — what the Home chat dock expands into. Thread list on the
// left, the selected conversation on the right; on a phone, one pane at a time.
// The conversation itself is the dock's own ConversationPane, so attachments and
// the transaction status behave exactly the same in both places.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { color, font, fontSize, lineHeight, letterSpacing, space, radius, elevation, layout } from '../../components/ui/tokens';
import { ReportLink } from '../../components/ui/ReportBusinessModal';
import { ConversationPane, ThreadRow, TrustlinkMark } from '../home-feed/HomeFeed';
import type { FulfillmentOut } from '../../lib/api/requirements';
import type { BusinessId, Message, MessageThread } from '../../lib/types';

export interface MessagesProps {
  viewerId: BusinessId;
  threads: MessageThread[];
  loading: boolean;
  messagesByThread: Record<string, Message[]>;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onSend: (threadId: string, body: string, file?: File) => Promise<string | null> | void;
  onOpenAttachment?: (threadId: string, messageId: string) => void;
  onOpenRequirement?: (requirementId: string) => void;
  fulfillmentByThread: Record<string, FulfillmentOut | null>;
  onBack?: () => void;
}

// Below this the list and the conversation can't sit side by side.
const TWO_PANE_MIN = 720;

export default function Messages({
  viewerId,
  threads,
  loading,
  messagesByThread,
  selectedThreadId,
  onSelectThread,
  onSend,
  onOpenAttachment,
  onOpenRequirement,
  fulfillmentByThread,
  onBack,
}: MessagesProps) {
  const { width } = useWindowDimensions();
  const twoPane = width >= TWO_PANE_MIN;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const selected = threads.find((t) => t.id === selectedThreadId) ?? null;
  const showList = twoPane || !selected;
  const showConversation = twoPane || !!selected;

  return (
    <View style={styles.root}>
      <View style={styles.shell}>
        <View style={styles.titleRow}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={6}>
              <Text style={styles.link}>← Back</Text>
            </Pressable>
          )}
          <Text style={styles.title}>Messages</Text>
        </View>

        <View style={styles.frame}>
          {showList && (
            <View style={[styles.listPane, twoPane ? styles.listPaneWide : { flex: 1 }]}>
              {loading ? (
                <ActivityIndicator color={color.primary} style={{ marginTop: space.xl }} />
              ) : threads.length === 0 ? (
                <Text style={[styles.muted, { padding: space.lg }]}>
                  No conversations yet. Messaging opens once a requirement you&apos;re part of is awarded.
                </Text>
              ) : (
                <ScrollView>
                  {threads.map((t) => (
                    <View key={t.id} style={t.id === selectedThreadId ? styles.rowSelected : null}>
                      <ThreadRow thread={t} now={now} onPress={() => onSelectThread(t.id)} />
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {showConversation && (
            <View style={styles.conversationPane}>
              {selected ? (
                <>
                  <View style={styles.conversationHead}>
                    {!twoPane && (
                      <Pressable onPress={() => onSelectThread(null)} hitSlop={8}>
                        <Text style={styles.link}>←</Text>
                      </Pressable>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.headName} numberOfLines={1}>{selected.counterpartyName}</Text>
                      {onOpenRequirement ? (
                        <Pressable onPress={() => onOpenRequirement(selected.requirementId)} hitSlop={4}>
                          <Text style={styles.headRef}>{selected.requirementRef} · View requirement</Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.headRef}>{selected.requirementRef}</Text>
                      )}
                    </View>
                    <ReportLink businessId={selected.counterpartyId} businessName={selected.counterpartyName} />
                  </View>
                  <ConversationPane
                    key={selected.id}
                    messages={messagesByThread[selected.id] ?? []}
                    viewerId={viewerId}
                    onSend={(body, file) => onSend(selected.id, body, file)}
                    onOpenAttachment={onOpenAttachment && ((messageId) => onOpenAttachment(selected.id, messageId))}
                    fulfillment={fulfillmentByThread[selected.id]}
                  />
                </>
              ) : (
                <View style={styles.emptyConversation}>
                  <TrustlinkMark />
                  <Text style={styles.muted}>Select a conversation.</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas, alignItems: 'center' },
  shell: { flex: 1, width: '100%', maxWidth: layout.maxWidthShell, paddingHorizontal: layout.screenPadding, paddingVertical: space.lg, gap: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontFamily: font.display, fontSize: fontSize.xl, lineHeight: lineHeight.xl, letterSpacing: letterSpacing.tight, color: color.ink },
  link: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  muted: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  frame: { ...elevation.cardRaised, flex: 1, minHeight: 0, flexDirection: 'row', borderRadius: radius.xl, backgroundColor: color.surface, overflow: 'hidden' },
  listPane: { minHeight: 0 },
  listPaneWide: { width: 320, borderRightWidth: 1, borderRightColor: color.border },
  rowSelected: { backgroundColor: color.primaryFaint },
  conversationPane: { flex: 1, minWidth: 0, minHeight: 0 },
  conversationHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.border },
  headName: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  headRef: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  emptyConversation: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
});
