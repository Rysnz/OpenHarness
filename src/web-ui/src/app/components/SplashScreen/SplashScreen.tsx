/**
 * SplashScreen - full-screen loading overlay shown on app start.
 *
 * Loading: logo breathes while the app initializes.
 * Exiting: logo resolves to the static mark while the backdrop dissolves.
 */

import React, { useEffect, useCallback } from 'react';
import { OpenHarnessLogo } from '@/component-library';
import './SplashScreen.scss';

interface SplashScreenProps {
  isExiting: boolean;
  onExited: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ isExiting, onExited }) => {
  const handleExited = useCallback(() => {
    onExited();
  }, [onExited]);

  // Remove from DOM after exit animation completes (~650 ms).
  useEffect(() => {
    if (!isExiting) return;
    const timer = window.setTimeout(handleExited, 650);
    return () => window.clearTimeout(timer);
  }, [isExiting, handleExited]);

  return (
    <div
      className={`splash-screen${isExiting ? ' splash-screen--exiting' : ''}`}
      aria-hidden="true"
    >
      <div className="splash-screen__center">
        <div className="splash-screen__logo-wrap">
          <OpenHarnessLogo
            size={104}
            className="splash-screen__logo"
            animated
            status={isExiting ? 'resolved' : 'loading'}
          />
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;
