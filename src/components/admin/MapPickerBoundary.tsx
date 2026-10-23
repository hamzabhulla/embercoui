import React from 'react';
import { ghostBtn } from './ui';

/**
 * Failure shell for the lazily-loaded map picker. If the Leaflet chunk
 * cannot load (a dropped connection, a stale deploy), the picker panel
 * degrades to this note + retry instead of unmounting the whole
 * Settings page with it — and the plain Map location text field lives
 * OUTSIDE this boundary, so it keeps working either way.
 *
 * Retry needs a genuinely fresh import: a rejected chunk stays rejected
 * on the same lazy() object forever, so the parent owns an attempt
 * counter, rebuilds the lazy component per attempt, and this boundary
 * just clears its own failure and calls onRetry.
 */
export class MapPickerBoundary extends React.Component<
  { onRetry: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('[ember] map picker failed to load', error);
  }

  private retry = () => {
    this.setState({ failed: false });
    this.props.onRetry();
  };

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-[10px] border border-[#EAE3D3] bg-[#FBF8F1] px-4 py-3.5">
          <p className="font-bodytext text-[12.5px] text-[#5C665C]">
            The map could not be loaded — check your connection and try again. The Map location text field above keeps working in the meantime.
          </p>
          <div className="pt-2.5">
            <button type="button" className={ghostBtn} onClick={this.retry}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
