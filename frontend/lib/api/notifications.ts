// lib/api/notifications.ts
// Maps to backend app/api/routes/notifications.py (prefix /notifications).
import { api } from './client';

export interface NotificationOut {
  id: number;
  type: string; // REQUIREMENT_CLOSING | DECISION | VERIFICATION | MESSAGE_RECEIVED | QUESTION_ASKED | QUESTION_ANSWERED
  title: string;
  detail: string;
  urgent: boolean;
  read: boolean;
  created_at: string;
}

export const notificationsApi = {
  listMine: () => api.get<NotificationOut[]>('/notifications'),
  markRead: (id: number) => api.post<void>(`/notifications/${id}/read`),
  markAllRead: () => api.post<void>('/notifications/read-all'),
};
