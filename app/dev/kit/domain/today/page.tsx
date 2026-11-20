// /dev/kit/domain/today: the composed Today mock-up (wireframe B) built only from FE-1b domain components.
import type { Metadata } from 'next';
import { loadKitData } from '../_kit/load';
import { TodayMock } from '../_kit/TodayMock';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Today mock-up · Domain kit' };

export default async function TodayMockPage() {
  const data = await loadKitData();
  return <TodayMock data={data} />;
}
