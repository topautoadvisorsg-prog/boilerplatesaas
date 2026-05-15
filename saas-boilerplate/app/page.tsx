import Link from "next/link";
import { appConfig } from "@/lib/config/app";

export default function RootPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl w-full space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight">{appConfig.name}</h1>
        <p className="text-[var(--color-muted)]">{appConfig.marketing.headline}</p>
        <p className="text-sm text-[var(--color-muted)]">{appConfig.marketing.subhead}</p>
        <div className="flex gap-3">
          <Link
            href="/sign-in"
            className="px-4 py-2 rounded-md bg-[var(--color-accent)] text-black font-medium"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="px-4 py-2 rounded-md border border-[var(--color-border)]"
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  );
}
