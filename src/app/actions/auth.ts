"use server";

import { signIn } from "@/auth";

export async function signInWithProvider(provider: "google" | "github" | "talerid") {
  await signIn(provider, { redirectTo: "/" });
}
