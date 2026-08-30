import type { WelcomeScreenProps } from '@truefoundry/trueforge-ui';

/**
 * WelcomeScreen override — an empty state that tells the operator exactly what to
 * submit, instead of a generic "how can I help". The shape here matches what the
 * agent's instructions expect.
 */
export function SubmitPrompt(_props: WelcomeScreenProps) {
  return (
    <div
      style={{
        maxWidth: 460,
        margin: '0 auto 20px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
        Submit a release candidate
      </div>
      <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: '0 0 12px' }}>
        Freeze, Readiness and Rollback all run, the risk score is computed in code, and
        you approve the go / no-go and the comms.
      </p>
      <pre
        style={{
          textAlign: 'left',
          fontSize: 12,
          lineHeight: 1.55,
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius, 6px)',
          padding: '10px 12px',
          margin: 0,
          overflowX: 'auto',
          color: 'var(--text-primary)',
        }}
      >
{`Evaluate release candidate "rc-1042".
Repo owner: JyothsnaAshok
Repo name: orders-service
Clone URL: https://github.com/JyothsnaAshok/orders-service.git
Candidate ref: release/v1.3.0
Last release tag: v1.2.0`}
      </pre>
    </div>
  );
}
