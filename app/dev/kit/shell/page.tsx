// Dev-only kit for the v2 frame (V2-SHELL): sidebar, topbar and the docked right panel in each state.
import { notFound } from 'next/navigation';
import { ShellKit } from './ShellKit';

export const metadata = { title: 'Shell kit · Command Center' };

export default function ShellKitPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <ShellKit />;
}
