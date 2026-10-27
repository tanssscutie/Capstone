// lib/useMessaging.ts
// Award-conversation data shared by the Home chat dock and the full /messages
// page: thread list (polled), each thread's messages, its close-out state, and
// the handlers both screens pass straight into their chat components. The order
// status shown in a conversation is read-only (fulfillment_service).
import { useCallback, useEffect, useState } from 'react';
import { messagesApi, openMessageAttachment } from './api/messages';
import { requirementsApi, type FulfillmentOut } from './api/requirements';
import { mapMessage, mapMessageThread } from './api/mappers';
import { errorMessage } from './api/client';
import type { Message, MessageThread } from './types';

const MESSAGE_THREADS_POLL_MS = 15_000;

export function useMessaging() {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [messagesByThread, setMessagesByThread] = useState<Record<string, Message[]>>({});
  // Order status per thread — every thread is an awarded deal.
  const [fulfillmentByThread, setFulfillmentByThread] = useState<Record<string, FulfillmentOut | null>>({});

  const refreshThreads = useCallback(async () => {
    try {
      const rows = await messagesApi.listThreads();
      setThreads(rows.map(mapMessageThread));
    } catch {
      // Transient failure — the next poll tries again.
    } finally {
      setThreadsLoaded(true);
    }
  }, []);

  // Refreshes previews/unread flags so a new award or an incoming reply shows up
  // without a reload. An open conversation's content is refetched on open.
  useEffect(() => {
    refreshThreads();
    const id = setInterval(refreshThreads, MESSAGE_THREADS_POLL_MS);
    return () => clearInterval(id);
  }, [refreshThreads]);

  const requirementIdOf = (threadId: string) => Number(threads.find((t) => t.id === threadId)?.requirementId);

  async function reloadThreadMessages(threadId: string) {
    try {
      const rows = await messagesApi.listMessages(Number(threadId));
      setMessagesByThread((prev) => ({ ...prev, [threadId]: rows.map(mapMessage) }));
    } catch {
      // The next open re-fetches anyway.
    }
  }

  const onOpenThread = async (threadId: string) => {
    await reloadThreadMessages(threadId);
    // A failed fetch just leaves the status line out of this conversation.
    const requirementId = requirementIdOf(threadId);
    if (requirementId) {
      const fulfillment = await requirementsApi.getFulfillment(requirementId).catch(() => null);
      setFulfillmentByThread((prev) => ({ ...prev, [threadId]: fulfillment }));
    }
    try {
      await messagesApi.markRead(Number(threadId));
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread: false } : t)));
    } catch {
      // Not read-marked server-side; the unread dot just stays until the next poll.
    }
  };

  const onOpenAttachment = (threadId: string, messageId: string) => {
    openMessageAttachment(Number(threadId), Number(messageId)).catch(() => {
      if (typeof window !== 'undefined') window.alert('Could not open that file. Try again.');
    });
  };

  const onSendMessage = async (threadId: string, body: string, file?: File): Promise<string | null> => {
    if (file) {
      try {
        const sent = await messagesApi.sendAttachment(Number(threadId), file, file.name, body);
        await reloadThreadMessages(threadId);
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId
            ? { ...t, lastMessagePreview: sent.body || `Sent a file: ${file.name}`, lastMessageAt: sent.created_at }
            : t)),
        );
        return null;
      } catch (e: any) {
        return errorMessage(e, 'Could not send that file.');
      }
    }
    // The chat UI already shows its own optimistic copy (HomeFeed.tsx's sentByThread) —
    // this only persists it. Not appended into messagesByThread, or it would render twice.
    try {
      const sent = await messagesApi.send(Number(threadId), body);
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, lastMessagePreview: sent.body, lastMessageAt: sent.created_at } : t)),
      );
    } catch {
      // The optimistic bubble stays visible for this session even though it never
      // made it to the server — acceptable for a first pass.
    }
    return null;
  };

  return {
    threads,
    threadsLoaded,
    refreshThreads,
    reloadThreadMessages,
    messagesByThread,
    fulfillmentByThread,
    onOpenThread,
    onOpenAttachment,
    onSendMessage,
  };
}
