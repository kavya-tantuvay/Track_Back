import { Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { toPgVector } from "../lib/vector";
import type { CreateItemInput, ListItemsQuery } from "../lib/validation";

// Fields to return for an item (never the raw embedding).
const itemSelect = {
  id: true,
  type: true,
  status: true,
  title: true,
  description: true,
  category: true,
  location: true,
  date: true,
  contact: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
  ownerId: true,
  owner: { select: { id: true, username: true } },
} satisfies Prisma.ItemSelect;

export async function createItem(params: {
  ownerId: string;
  input: CreateItemInput;
  imageUrl: string | null;
  embedding: number[];
}) {
  const { ownerId, input, imageUrl, embedding } = params;

  const item = await prisma.item.create({
    data: {
      ownerId,
      type: input.type,
      title: input.title,
      description: input.description,
      category: input.category,
      location: input.location,
      date: input.date,
      contact: input.contact ? input.contact : null,
      imageUrl,
    },
    select: itemSelect,
  });

  // Write the embedding separately — it's an Unsupported("vector") column.
  await prisma.$executeRaw`
    UPDATE "Item" SET embedding = ${toPgVector(embedding)}::vector WHERE id = ${item.id}
  `;

  return item;
}

export async function listItems(query: ListItemsQuery, viewerId?: string) {
  const where: Prisma.ItemWhereInput = {};
  if (query.type) where.type = query.type;
  if (query.category) where.category = query.category;
  if (query.status) where.status = query.status;
  if (query.mine && viewerId) where.ownerId = viewerId;
  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      { location: { contains: query.q, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.findMany({
      where,
      select: itemSelect,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return { total, page: query.page, pageSize: query.pageSize, items };
}

export function getItem(id: string) {
  return prisma.item.findUnique({ where: { id }, select: itemSelect });
}

export function setStatus(id: string, status: "open" | "resolved") {
  return prisma.item.update({ where: { id }, data: { status }, select: itemSelect });
}

export function deleteItem(id: string) {
  return prisma.item.delete({ where: { id } });
}

export async function countsByType() {
  const grouped = await prisma.item.groupBy({
    by: ["type", "status"],
    _count: { _all: true },
  });
  const result = { lost: 0, found: 0, resolved: 0, total: 0 };
  for (const g of grouped) {
    result.total += g._count._all;
    if (g.status === "resolved") result.resolved += g._count._all;
    if (g.type === "lost") result.lost += g._count._all;
    if (g.type === "found") result.found += g._count._all;
  }
  return result;
}
