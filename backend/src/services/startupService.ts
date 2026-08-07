import { prisma } from "../db.js";

export type CreateStartupInput = {
  name: string;
  tagline?: string | null;
  sector?: string | null;
  stage?: string | null;
  logo_url?: string | null;
  website_url?: string | null;
};

export type UpdateStartupInput = Partial<CreateStartupInput>;

export async function createStartup(input: CreateStartupInput) {
  return prisma.startup.create({ data: input });
}

export async function getStartupById(id: string) {
  return prisma.startup.findUnique({
    where: { id },
    include: { people: true },
  });
}

export async function listStartups(params?: { q?: string; take?: number; skip?: number }) {
  const { q, take = 200, skip = 0 } = params ?? {};
  return prisma.startup.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { tagline: { contains: q } },
            { sector: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
    take,
    skip,
  });
}

export async function updateStartup(id: string, input: UpdateStartupInput) {
  return prisma.startup.update({ where: { id }, data: input });
}

export async function deleteStartup(id: string) {
  return prisma.startup.delete({ where: { id } });
}

