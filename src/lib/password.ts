import bcrypt from "bcryptjs";

const COST = 12;

// Pre-computed bcrypt hash of a random secret; used to keep timing constant
// when a user with the supplied identifier doesn't exist (defends against
// account enumeration via response-time side-channel).
export const DUMMY_HASH =
  "$2b$12$CwTycUXWue0Thq9StjUM0uJ8mP1bGuUu7sP1zSDl/oCM3xQ6m2dpu";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    // Still pay the bcrypt cost so attackers can't enumerate accounts.
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
