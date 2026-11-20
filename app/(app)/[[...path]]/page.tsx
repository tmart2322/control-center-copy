// The catch-all for every in-frame URL (ROUTER): `/`, `/today`, `/deals/:accountId`… The page itself is rendered by the
// client router in the group's layout (../ClientRouter.tsx); this segment only runs on a full load (a reload or a deep
// link), where it sets the title and applies legacy redirects. It renders nothing.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { documentTitleFor, matchRoute, NOT_FOUND_TITLE, pageTitleFor, queryFromRecord, redirectFor } from '@/components/shell/routes';

// Rendered per request (it reads the query); nothing here is worth prerendering.
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const pathOf = (segs: string[] | undefined) => `/${(segs ?? []).join('/')}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const p = pathOf(path);
  return { title: documentTitleFor(matchRoute(p).key === 'notFound' ? NOT_FOUND_TITLE : pageTitleFor(p)) };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ path }, sp] = await Promise.all([params, searchParams]);
  const to = redirectFor(pathOf(path), queryFromRecord(sp));
  if (to) redirect(to);
  return null;
}
