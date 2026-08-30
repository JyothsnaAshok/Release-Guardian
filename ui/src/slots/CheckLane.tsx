import type { SubAgentCardProps } from '@truefoundry/trueforge-ui';
import { verdict } from '../theme';

/**
 * SubAgentCard override — renders each parallel check (Freeze / Readiness /
 * Rollback) as a labelled lane that collapses to a one-line status. This is the
 * visual proof of the harness's subagent fan-out.
 */
const LANE_LABELS: Record<string, string> = {
  freeze: 'Freeze Check',
  readiness: 'Readiness Check',
  rollback: 'Rollback Check',
};

function laneName(agentName: string, instruction: string): string {
  const hay = `${agentName} ${instruction}`.toLowerCase();
  for (const key of Object.keys(LANE_LABELS)) if (hay.includes(key)) return LANE_LABELS[key];
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
  const label =
    status === 'running' ? 'running…' : status === 'success' ? 'done' : 'error';

  return (
    <div
      style={{
        border: '1px solid var(--aui-border, #e2e8f0)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        margin: '6px 0',
        background: 'var(--aui-card-bg, #fff)',
      }}
    >
      <button
        onClick={onToggle}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 12px',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            flex: '0 0 auto',
            animation: status === 'running' ? 'rg-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        />
        <strong style={{ fontSize: 13 }}>{laneName(agentName, instruction)}</strong>
        <span style={{ fontSize: 12, color: 'var(--aui-text-secondary, #64748b)' }}>{label}</span>
        {durationText && (
          <span style={{ fontSize: 11, color: 'var(--aui-text-secondary, #64748b)', marginLeft: 'auto' }}>
            {durationText}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--aui-text-secondary, #64748b)' }}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && <div style={{ padding: '0 12px 10px 30px' }}>{children}</div>}
      <style>{`@keyframes rg-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
    </div>
  );
}
