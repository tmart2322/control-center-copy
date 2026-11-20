/**
 * FE-1c Composer. Page lanes import from here:
 *   import { Composer, ComposerInline, ConfirmSendDialog, SendCountdownToast } from '@/components/composer';
 */
export { Composer, ComposerSkeleton, type ComposerProps, type ComposerHandle, type ComposerPrimaryState } from './Composer';
export { ComposerInline, type ComposerInlineProps } from './ComposerInline';
export { ConfirmSendDialog, confirmLabel, confirmTitle, type ConfirmSendDialogProps } from './ConfirmSendDialog';
export { SendCountdownToast, type SendCountdownToastProps } from './SendCountdownToast';
export { RecipientPreview, type RecipientPreviewProps } from './RecipientPreview';
export { ActionPreview, type ActionPreviewProps } from './ActionPreview';
export { CanvasReview } from './CanvasReview';
export { PayloadPanel, type PayloadPanelProps } from './PayloadPanel';
export { DestinationChip, type DestinationChipProps } from './DestinationChip';
export { DraftProposal, ConflictBanner, DiffText, type DraftProposalProps } from './DraftProposal';
export { ThreadContext, type ThreadContextProps } from './ThreadContext';
export { SendFlow, outcomeOf, type SendState, type SendPhase, type SendOutcome, type SendError, type SendFlowDeps } from './send-flow';
export { DraftAutosave, type AutosaveState, type AutosaveStatus, type AutosaveDeps } from './autosave';
export { purify, previewHtml, serverPreviewHtml, payloadView, serverPayloadView, clientPayload, previewParity, type PayloadView } from './preview';
export {
  toComposeDestination,
  destinationLabel,
  destinationParts,
  destinationShort,
  recipientRows,
  switchCandidates,
  switchOptions,
  lossyLine,
  mentionCandidates,
  renditionFormatFor,
  type MentionCandidate,
  type SwitchOption,
} from './destination';
