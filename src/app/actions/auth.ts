"use server";

import { signIn } from "@/auth";

export async function signInWithProvider(provider: "google" | "github") {
  await signIn(provider, { redirectTo: "/" });
}
