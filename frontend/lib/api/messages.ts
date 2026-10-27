// lib/api/messages.ts
// Maps to backend app/api/routes/messages.py (prefix /messages). A thread only
// exists once the proposed winner accepts the award (one per awarded business,
// opened with a system message) — there is no "start a chat" call here.
import { api, API_BASE_URL, tokenStore } from './client';

export interface MessageThreadOut {
  id: number;
  requirement_id: number;
  requirement_ref_code: string;
  awarded_quotation_id: number;
  counterparty_id: number;
  counterparty_name: string;
  last_message_preview: string;
  last_message_at: string | null;
  unread: boolean;
}

export interface MessageOut {
  id: number;
  thread_id: number;
  sender_id: number;
  body: string;
  /** The platform's award-confirmation message — shown as TrustLink, not the sender. */
  is_system: boolean;
  /** Set when the message carries one file — open it with openMessageAttachment. */
  attachment_filename: string | null;
  attachment_size: number | null;
  created_at: string;
  read: boolean;
}

export const messagesApi = {
  listThreads: () => api.get<MessageThreadOut[]>('/messages/threads'),
  listMessages: (threadId: number) => api.get<MessageOut[]>(`/messages/threads/${threadId}`),
  send: (threadId: number, body: string) => api.post<MessageOut>(`/messages/threads/${threadId}`, { body }),
  markRead: (threadId: number) => api.post<void>(`/messages/threads/${threadId}/read`),
  /** One file per message, optional text alongside it. */
  sendAttachment: (threadId: number, file: File | Blob, fileName: string, body?: string) => {
    const form = new FormData();
    form.append('file', file, fileName);
    if (body && body.trim()) form.append('body', body.trim());
    return api.postForm<MessageOut>(`/messages/threads/${threadId}/attachments`, form);
  },
};

/** Raw bytes, so fetched by hand with the auth header and opened as a blob: URL —
 *  same reasoning as admin.ts's openAdminDocumentFile. Web only. */
export async function openMessageAttachment(threadId: number, messageId: number): Promise<void> {
  if (typeof window === 'undefined') return;
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE_URL}/messages/threads/${threadId}/messages/${messageId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Could not open that file (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
