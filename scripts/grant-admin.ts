import { config } from "dotenv";
config({ path: ".env.local" });

import { prisma } from "@/lib/prisma";
import { grantAdminCore } from "@/lib/grant-admin-core";

function parseArgs(argv: string[]): {
  email?: string;
  telegram?: string;
  github?: string;
} {
  const out: { email?: string; telegram?: string; github?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--telegram") out.telegram = argv[++i];
    else if (a === "--github") out.github = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await grantAdminCore(prisma, args);
  if (result.ok) {
    console.log(`Granted ADMIN to user ${result.userId}`);
    process.exit(0);
  } else {
    console.error(`Failed: ${result.reason}`);
    console.error(
      "Usage: npm run grant-admin -- --email foo@bar.com\n" +
        "       npm run grant-admin -- --telegram 12345678\n" +
        "       npm run grant-admin -- --github 98765",
    );
    process.exit(1);
  }
}

main().finally(() => prisma.$disconnect());
