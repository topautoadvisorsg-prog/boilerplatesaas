import Stripe from "stripe";
import { getEnv } from "@/lib/env";

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const { STRIPE_SECRET_KEY } = getEnv();
  _stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });
  return _stripe;
}
