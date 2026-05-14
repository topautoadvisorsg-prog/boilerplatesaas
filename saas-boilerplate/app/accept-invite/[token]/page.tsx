import { acceptInviteAction } from "./actions";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form action={acceptInviteAction.bind(null, token)} className="w-full max-w-md bg-[var(--color-card)] border rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-semibold">Accept invitation</h1>
        <p className="text-sm text-[var(--color-muted)]">
          You&apos;re signed in. Click below to join the workspace.
        </p>
        <button className="w-full px-4 py-2 rounded-md bg-[var(--color-accent)] text-black font-medium">
          Accept &amp; continue
        </button>
      </form>
    </main>
  );
}
