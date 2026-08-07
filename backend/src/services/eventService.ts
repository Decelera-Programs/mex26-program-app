import { prisma } from "../db.js";
import type { EventType } from "../types.js";

export type CreateEventInput = {
  title: string;
  description?: string | null;
  start_time: Date;
  end_time: Date;
  location: string;
  type: EventType;
  visible_to_contact_types?: string[];
};

export type UpdateEventInput = Partial<CreateEventInput>;

export async function createEvent(input: CreateEventInput) {
  return prisma.event.create({ data: input });
}

export async function getEventById(id: string) {
  return prisma.event.findUnique({
    where: { id },
  });
}

export async function listEvents(params?: {
  from?: Date;
  to?: Date;
  type?: EventType;
  take?: number;
  skip?: number;
}) {
  const { from, to, type, take = 200, skip = 0 } = params ?? {};
  return prisma.event.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(from || to
        ? {
            start_time: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { start_time: "asc" },
    take,
    skip,
  });
}

export async function updateEvent(id: string, input: UpdateEventInput) {
  return prisma.event.update({ where: { id }, data: input });
}

export async function deleteEvent(id: string) {
  return prisma.event.delete({ where: { id } });
}

