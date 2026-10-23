import { maskPii, type PiiKind } from '../../lib/pii';
import { useLock } from './LockContext';

/**
 * One customer-PII value (Phase D). Renders the value untouched
 * while the admin screen is unlocked, and the shared masked form
 * (lib/pii) while it is locked. Every PII spot on the orders board
 * goes through this component, driven by the single lock state, so
 * masking is a property of the screen — never of an individual
 * component remembering to hide something.
 */
export default function Pii({ value, kind }: { value: string | null | undefined; kind: PiiKind }) {
  const { locked } = useLock();
  if (!value) return null;
  return <>{locked ? maskPii(value, kind) : value}</>;
}
