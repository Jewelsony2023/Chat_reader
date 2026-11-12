import { Suspense } from "react";
import type { Metadata } from "next";
import ReportView from "@/components/report/ReportView";

export const metadata: Metadata = {
  title: "Your Vibe Check — by Max",
  robots: { index: false, follow: false },
};

async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportView id={id} />;
}

export default function Page({ params }: PageProps<"/report/[id]">) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-xl px-4 py-24 text-ink-3">Opening your report…</main>}>
      <Report params={params} />
    </Suspense>
  );
}
