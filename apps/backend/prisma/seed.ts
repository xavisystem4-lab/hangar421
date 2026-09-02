/* eslint-disable no-console */
// CLI: `npm run db:seed` — la lógica real vive en src/bootstrap/seed-demo-data.ts
// (compartida con el arranque automático del backend embebido en el POS Windows).
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../src/bootstrap/seed-demo-data";

const prisma = new PrismaClient();

seedDemoData(prisma)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
