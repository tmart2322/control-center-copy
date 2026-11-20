/**
 * "This browser has seen this app set up" (B-079 gate), per data mode. The gate only uses it to decide whether to hold
 * the app's queries until the onboarding check answers: a known-onboarded browser renders at once, and the check
 * still runs in the background (a database that was reset sends you to /onboarding all the same).
 */
const KEY = 'cc.onboarded';

export type OnboardedMode = 'mock' | 'db';

export function readOnboarded(): OnboardedMode | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'mock' || v === 'db' ? v : null;
  } catch {
    return null;
  }
}

export function writeOnboarded(mode: OnboardedMode | null): void {
  try {
    if (mode) window.localStorage.setItem(KEY, mode);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode: the check simply runs every time */
  }
}

export const isOnboardingPath = (pathname: string | null | undefined) => {
  const p = (pathname ?? '/').split('?')[0]!;
  return p === '/onboarding' || p.startsWith('/onboarding/');
};
