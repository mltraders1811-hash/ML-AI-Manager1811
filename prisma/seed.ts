// Creates the single V1 tenant. Run once per environment: `npm run db:seed`.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const companyId = process.env.DEFAULT_COMPANY_ID;
  if (!companyId) {
    throw new Error("DEFAULT_COMPANY_ID is not set - see .env.example");
  }

  const company = await prisma.company.upsert({
    where: { id: companyId },
    update: {},
    create: { id: companyId, name: "Default Company" },
  });

  console.log(`Seeded company ${company.id} (${company.name})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
