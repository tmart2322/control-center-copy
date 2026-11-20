export { AppFrame, type AppFrameProps } from './AppFrame';
export { useShell, useShellOptional, CHAT_TAB, type RailPanelDef, type UtilityId } from './ShellContext';
export { RailPanel, NavStrip, railPanelDomId, type RailPanelProps } from './slots';
export { AssistantTile } from './RightRail';
export { usePrefs, type Prefs, type Density, type ColorScheme, type TextSize, type BrandRamp } from './prefs';
export { PREFS_BOOT_SCRIPT, PREFS_KEY } from './prefs-boot';
export {
  NAV_GROUPS,
  NAV_DESTINATIONS,
  NAV_TABS,
  isNavActive,
  isTabActive,
  frameTier,
  panelWidthFor,
  type FrameTier,
  type NavItemDef,
  type NavGroupDef,
  type NavTabDef,
} from './nav';
export { Sidebar, SidebarLink, SidebarFooter, LogoTile } from './Sidebar';
export { Topbar, SearchField, NextMeetingChip } from './Topbar';
export { usePageTitle, pageTitleFor } from './titles';
// Route skeletons live in './RouteSkeleton' (imported directly: it pulls in every page's skeleton).
export { markNavPending, usePendingPath } from './nav-pending';
export { navigate, preloadPath, type NavigateOptions } from './router';
export { AppLink, type AppLinkProps } from './AppLink';
export { matchRoute, isClientPath, type RouteKey, type RouteMatch } from './routes';
export { StatusPopover, SpendPopover } from './StatusPanels';
export { UtilityItem, UtilityPanel } from './UtilityPanel';
export { ChatRail } from './ChatMount';
export { FirstScanBanner, useFirstScan } from './FirstScanBanner';
export { FillingIn, FillingInView, useFillingEmpty, type FillingInVariant } from './FillingIn';
export { ScannerPulse, pulseFor, humanizePulseLabel } from './ScannerPulse';
export { CommandPalette, hrefForRef } from './CommandPalette';
export { useChromeData, connectorTone } from './data';
export { RightPanelView, GenericDetail } from './RightPanel';
export {
  RightPanelProvider,
  useRightPanel,
  registerDetailRenderer,
  getDetailRenderer,
  type RightPanelApi,
  type PanelEntity,
  type PanelTab,
  type DetailRenderer,
} from './panel';
