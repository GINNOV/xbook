import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OAuthDonePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const provider = typeof params.provider === "string" ? params.provider : "account";
  const error = typeof params.error === "string" ? params.error : null;
  const label = provider === "youtube" ? "YouTube" : provider === "x" ? "X" : "Account";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-5 py-16 text-on-surface">
      <section
        className={`w-full max-w-lg rounded-2xl border-2 px-8 py-10 text-center shadow-sm ${
          error ? "border-red-300 bg-red-50" : "border-emerald-500 bg-emerald-50"
        }`}
      >
        <span
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-3xl font-bold text-white ${
            error ? "bg-red-600" : "bg-emerald-600"
          }`}
        >
          {error ? "!" : "✓"}
        </span>
        <p className={`mt-5 text-sm font-semibold uppercase tracking-wide ${error ? "text-red-800" : "text-emerald-800"}`}>
          {error ? "Sign-in failed" : "Connected"}
        </p>
        {error ? (
          <>
            <h1 className="mt-2 font-headline text-3xl font-semibold">{label} sign-in did not finish</h1>
            <p className="mt-3 text-sm leading-6 text-on-surface-variant">{error}</p>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-headline text-3xl font-semibold">{label} is connected</h1>
            <p className="mt-3 text-sm leading-6 text-emerald-900">
              You can close this browser tab and return to XBook. The desktop window updates on its own.
            </p>
          </>
        )}
        <Link
          href="/settings"
          className={`mt-6 inline-flex rounded-md px-4 py-2 text-sm font-semibold text-white ${
            error ? "bg-red-700 hover:bg-red-800" : "bg-emerald-700 hover:bg-emerald-800"
          }`}
        >
          Open Settings
        </Link>
      </section>
    </main>
  );
}
