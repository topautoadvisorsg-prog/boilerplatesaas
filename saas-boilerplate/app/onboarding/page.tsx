import { createOrgAction } from "./actions";
import { suggestSlugFromName } from "@/lib/tenant";
import { requireAppUser } from "@/lib/auth/current-user";

export default async function OnboardingPage() {
  await requireAppUser();
  const placeholder = suggestSlugFromName("acme-co");
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form action={createOrgAction} className="w-full max-w-md space-y-6 bg-[var(--color-card)] p-8 rounded-xl border">
        <div>
          <h1 className="text-2xl font-semibold">Create your workspace</h1>
          <p className="text-sm text-[var(--color-muted)] mt-1">Each workspace gets its own subdomain.</p>
        </div>
        <label className="block">
          <span className="text-sm">Workspace name</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={64}
            className="mt-1 w-full bg-transparent border rounded-md px-3 py-2"
            placeholder="Acme, Inc."
          />
        </label>
        <label className="block">
          <span className="text-sm">URL slug</span>
          <div className="mt-1 flex items-center border rounded-md overflow-hidden">
            <input
              name="slug"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9-]+"
              defaultValue={placeholder}
              className="flex-1 bg-transparent px-3 py-2"
            />
            <span className="px-3 py-2 text-sm text-[var(--color-muted)] border-l">
              .{process.env.NEXT_PUBLIC_APP_DOMAIN ?? "ourapp.com"}
            </span>
          </div>
        </label>
        <button
          type="submit"
          className="w-full px-4 py-2 rounded-md bg-[var(--color-accent)] text-black font-medium"
        >
          Create workspace
        </button>
      </form>
    </main>
  );
}
