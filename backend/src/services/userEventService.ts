import { prisma } from "../db.js";

export type CreateUserEventInput = {
  user_id: string;
  event_id: string;
};

export async function addEventToUserSchedule(input: CreateUserEventInput) {
  return prisma.userEvent.create({ data: input });
}

export async function removeEventFromUserSchedule(params: { user_id: string; event_id: string }) {
  return prisma.userEvent.delete({
    where: {
      user_id_event_id: {
        user_id: params.user_id,
        event_id: params.event_id,
      },
    },
  });
}

export async function listUserScheduleEvents(user_id: string) {
  // Personalized Agenda requirement: Events filtered through UserEvent for the user_id.
  const joins = await prisma.userEvent.findMany({
    where: { user_id },
    include: { event: true },
    orderBy: { event: { start_time: "asc" } },
  });
  return joins.map((j) => j.event);
}

export async function listUserEventJoins(user_id: string) {
  return prisma.userEvent.findMany({
    where: { user_id },
    orderBy: { createdAt: "desc" },
  });
}

