// app/messages.tsx
// Full-page Messages (the chat dock, expanded). `?thread=<id>` opens that conversation.
import { useEffect, useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Messages from '../features/messages/Messages';
import { me } from '../lib/api/auth';
import { useMessaging } from '../lib/useMessaging';
import type { Message } from '../lib/types';

const OPEN_THREAD_POLL_MS = 15_000;

export default function MessagesRoute() {
  const router = useRouter();
  const { thread } = useLocalSearchParams<{ thread?: string }>();
  const chat = useMessaging();
  const [viewerId, setViewerId] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(typeof thread === 'string' ? thread : null);
  // Text messages show instantly; cleared once the thread is re-fetched.
  const [pending, setPending] = useState<Record<string, Message[]>>({});

  useEffect(() => {
    me().then((u) => setViewerId(String(u.id))).catch(() => undefined);
  }, []);

  // Load the selected conversation once its thread is known, then keep it fresh.
  const selectedKnown = !!selectedId && chat.threads.some((t) => t.id === selectedId);
  useEffect(() => {
    if (!selectedId || !selectedKnown) return;
    chat.onOpenThread(selectedId);
    const id = setInterval(() => chat.reloadThreadMessages(selectedId), OPEN_THREAD_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedKnown]);

  const messagesByThread = Object.fromEntries(
    chat.threads.map((t) => [t.id, [...(chat.messagesByThread[t.id] ?? []), ...(pending[t.id] ?? [])]]),
  );

  return (
    <Messages
      viewerId={viewerId}
      threads={chat.threads}
      loading={!chat.threadsLoaded}
      messagesByThread={messagesByThread}
      selectedThreadId={selectedId}
      onSelectThread={(id) => {
        setSelectedId(id);
        router.setParams({ thread: id ?? undefined });
      }}
      onSend={async (threadId, body, file) => {
        if (file) return chat.onSendMessage(threadId, body, file);
        const local: Message = {
          id: `m-local-${Date.now()}`, threadId, senderId: viewerId, body, isSystem: false,
          attachment: null, sentAt: new Date().toISOString(), read: true,
        };
        setPending((prev) => ({ ...prev, [threadId]: [...(prev[threadId] ?? []), local] }));
        await chat.onSendMessage(threadId, body);
        await chat.reloadThreadMessages(threadId);
        setPending((prev) => ({ ...prev, [threadId]: (prev[threadId] ?? []).filter((m) => m.id !== local.id) }));
        return null;
      }}
      onOpenAttachment={chat.onOpenAttachment}
      onOpenRequirement={(requirementId) => router.push({ pathname: '/requirement', params: { id: requirementId } })}
      fulfillmentByThread={chat.fulfillmentByThread}
      onBack={() => (router.canGoBack() ? router.back() : router.push('/home'))}
    />
  );
}
