import { serve } from "inngest/next";
import { inngest } from "@/lib/jobs/client";
import { functions } from "@/lib/jobs/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
