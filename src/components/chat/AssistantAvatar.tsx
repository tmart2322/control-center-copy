/** The assistant's identity tile: `bg-agentic` + one white sparkle (brief 12 §8.5). Claude, not Agentforce. */
import { Icon } from '@/ui';

export function AssistantAvatar({ size = 24, className = '' }: { size?: 24 | 28 | 32 | 40; className?: string }) {
  const glyph = size >= 32 ? 'lg' : size >= 28 ? 'md' : 'sm';
  return (
    <span className={`bg-agentic inline-grid shrink-0 place-items-center rounded-full ${className}`} style={{ width: size, height: size }} aria-hidden>
      <Icon name="sparkles" size={glyph} />
    </span>
  );
}
