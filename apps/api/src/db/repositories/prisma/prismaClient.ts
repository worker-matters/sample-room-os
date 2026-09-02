import { PrismaClient } from "@prisma/client";

export type SampleRoomPrismaClient = PrismaClient;

export function createPrismaClient() {
  return new PrismaClient();
}
