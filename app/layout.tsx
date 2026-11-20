// Root layout: brand tokens, providers and the v2 cockpit frame (sidebar · topbar · docked panel).
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '@/client/providers';
import { DevToolbar } from '@/components/dev-toolbar/DevToolbar';
import { AppFrame } from '@/components/shell/AppFrame';
import { ChatProvider } from '@/components/chat';
import { ChatRail } from '@/components/shell/ChatMount';
import { OnboardingGate } from '@/components/onboarding/OnboardingGate';
import { RightPanelProvider } from '@/components/shell/panel';
import { PREFS_BOOT_SCRIPT } from '@/components/shell/prefs-boot';

export const metadata: Metadata = {
  title: 'Command Center',
  description: 'Personal-ops cockpit. Nothing leaves without approval.',
};

const isDev = process.env.NODE_ENV === 'development';
/** The dev toolbar drives the mock (scenario clock, failure switch); its /api/v1/dev routes 404 on CC_DATA=db. */
const isMock = (process.env.CC_DATA ?? 'mock').toLowerCase() === 'mock';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // No theme attributes here: the tokens default to dark + comfortable + 16 px, and PREFS_BOOT_SCRIPT applies
    // the stored choice (data-theme / data-density / data-text) before first paint.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Self-hosted Salesforce Sans (licensed install, synced to public/fonts; falls back to system-ui). */}
        <link rel="preload" href="/fonts/SalesforceSans-Regular.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/SalesforceSans-Bold.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        {/* Apply stored theme / density / text size before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          {/* B-079: /onboarding renders alone (no frame, chat or panel); a database without a set-up user sends every page there. */}
          <OnboardingGate mode={isMock ? 'mock' : 'db'} page={children}>
            {/* The right panel sits above chat, so the assistant's "Looking at" chip reads useRightPanel().entity directly. */}
            <RightPanelProvider>
              {/* ⌘J belongs to the shell's key manager (GlobalKeys → the panel's Assistant tab → focusChat), so no second listener. */}
              <ChatProvider registerHotkey={false}>
                <AppFrame chatRail={<ChatRail />} devToolbar={isDev && isMock ? <DevToolbar /> : null}>
                  {children}
                </AppFrame>
              </ChatProvider>
            </RightPanelProvider>
          </OnboardingGate>
        </Providers>
      </body>
    </html>
  );
}
