import type { SubAgentCardProps } from '@truefoundry/trueforge-ui';
import { verdict } from '../theme';

/**
 * SubAgentCard override — each parallel check renders as a labelled status lane
 * that collapses to a single line. The lane's left rule carries the verdict
 * colour: this is the operator's at-a-glance read on the fan-out.
 */
const LANES: Record<string, string> = {
  freeze: 'Freeze',
  readiness: 'Readiness',
  rollback: 'Rollback',
};

function laneName(agentName: string, instruction: string): string {
  const hay = `${agentName} ${instruction}`.toLowerCase();
  for (const key of Object.keys(LANES)) if (hay.includes(key)) return LANES[key];
  return agentName || 'Check';
}

export function CheckLane({
  agentName,
  instruction,
  status,
  expanded,
  onToggle,
  durationText,
  children,
}: SubAgentCardProps) {
  const color =
    status === 'running' ? verdict.unknown : status === 'success' ? verdict.ok : verdict.bad;
  const label = status === 'running' ? 'running' : status === 'success' ? 'complete' : 'error';

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderLeft: `2px solid ${color}`,
        borderRadius: 'var(--radius, 6px)',
        background: 'var(--card-bg)',
        margin: '4px 0',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          width: '100%',
          padding: '9px 11px',
          font: 'inherit',
        }}
      >
        <span
          style={{
            flex: '0 0 auto',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: color,
            animation: status === 'running' ? 'rg-pulse 1.3s ease-in-out infinite' : undefined,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {laneName(agentName, instruction)}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {durationText && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{durationText}</span>
          )}
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{expanded ? '▾' : '▸'}</span>
        </span>
      </button>
      {expanded && (
        <div
          style={{
            padding: '2px 12px 10px 27px',
            borderTop: '1px solid var(--border)',
            fontSize: 13,
            color: 'var(--text-secondary)',
          }}
        >
          {children}
        </div>
      )}
      <style>{`@keyframes rg-pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </div>
  );
}
