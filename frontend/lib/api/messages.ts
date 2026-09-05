// lib/api/messages.ts
// Maps to backend app/api/routes/messages.py (prefix /messages). A thread only
// ever exists once a quotation releases (one per released respondent, created
// automatically at closing time) — there is no "start a chat" call here.
import { api } from './client';

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
  created_at: string;
  read: boolean;
}

export const messagesApi = {
  listThreads: () => api.get<MessageThreadOut[]>('/messages/threads'),
  listMessages: (threadId: number) => api.get<MessageOut[]>(`/messages/threads/${threadId}`),
  send: (threadId: number, body: string) => api.post<MessageOut>(`/messages/threads/${threadId}`, { body }),
  markRead: (threadId: number) => api.post<void>(`/messages/threads/${threadId}/read`),
};
