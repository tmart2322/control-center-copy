'use client';
/**
 * The guide's one mount in the frame (the sidebar): the Getting started card and the README dialog. Page help and
 * coach marks live with the topbar's "?" button (PageHelp.tsx).
 */
import { GettingStarted } from './GettingStarted';
import { ReadmeDialog } from './Readme';

export function GuideRoot({ collapsed }: { collapsed?: boolean }) {
  return (
    <>
      <GettingStarted collapsed={collapsed} />
      <ReadmeDialog />
    </>
  );
}
