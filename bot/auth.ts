export function isAllowed(userId: number, allowed: Set<number>): boolean {
  return allowed.has(userId);
}
