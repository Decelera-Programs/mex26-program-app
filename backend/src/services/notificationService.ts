import { prisma } from "../db.js";

export type CreateNotificationInput = {
  user_id: string;
  event_id?: string | null;
  message: string;
  sent_at?: Date;
};

export type UpdateNotificationInput = Partial<{
  message: string;
  is_read: boolean;
  sent_at: Date;
  event_id: string | null;
}>;

export async function createNotification(input: CreateNotificationInput) {
  return prisma.notification.create({
    data: {
      user_id: input.user_id,
      event_id: input.event_id ?? null,
      message: input.message,
      sent_at: input.sent_at ?? new Date(),
    },
  });
}

export async function listNotificationsForUser(user_id: string, params?: { unreadOnly?: boolean; take?: number }) {
  const { unreadOnly = false, take = 50 } = params ?? {};
  return prisma.notification.findMany({
    where: { user_id, ...(unreadOnly ? { is_read: false } : {}) },
    orderBy: { sent_at: "desc" },
    take,
  });
}

export async function markNotificationRead(id: string) {
  return prisma.notification.update({ where: { id }, data: { is_read: true } });
}

export async function markAllNotificationsRead(user_id: string) {
  await prisma.notification.updateMany({
    where: { user_id, is_read: false },
    data: { is_read: true },
  });
}

export async function updateNotification(id: string, input: UpdateNotificationInput) {
  return prisma.notification.update({ where: { id }, data: input });
}

export async function deleteNotification(id: string) {
  return prisma.notification.delete({ where: { id } });
}

