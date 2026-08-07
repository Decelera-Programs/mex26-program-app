import { prisma } from "../db.js";

export type CreatePersonInput = {
  full_name: string;
  bio?: string | null;
  photo_url?: string | null;
  linkedin_url?: string | null;
  company_name?: string | null;
  expertise_tags?: string[]; // will be stored as JSON string in SQLite
  startup_id?: string | null;
};

export type UpdatePersonInput = Partial<CreatePersonInput>;

function serializeTags(tags: string[] | undefined) {
  return JSON.stringify(tags ?? []);
}

export async function createPerson(input: CreatePersonInput) {
  return prisma.person.create({
    data: {
      ...input,
      expertise_tags: serializeTags(input.expertise_tags),
    },
  });
}

export async function getPersonById(id: string) {
  const person = await prisma.person.findUnique({
    where: { id },
    include: { startup: true },
  });
  return person;
}

export async function listPeople(params?: { q?: string; startup_id?: string; take?: number; skip?: number }) {
  const { q, startup_id, take = 200, skip = 0 } = params ?? {};
  return prisma.person.findMany({
    where: {
      ...(startup_id ? { startup_id } : {}),
      ...(q
        ? {
            OR: [
              { full_name: { contains: q } },
              { company_name: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { full_name: "asc" },
    take,
    skip,
    include: { startup: true },
  });
}

export async function updatePerson(id: string, input: UpdatePersonInput) {
  return prisma.person.update({
    where: { id },
    data: {
      ...input,
      ...(input.expertise_tags ? { expertise_tags: serializeTags(input.expertise_tags) } : {}),
    },
  });
}

export async function deletePerson(id: string) {
  return prisma.person.delete({ where: { id } });
}

