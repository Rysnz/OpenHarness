import type { FC } from 'react';
import SplashScreen from '../../app/components/SplashScreen/SplashScreen';

interface WorkbenchSplashProps {
  visible: boolean;
  isExiting: boolean;
  onExited: () => void;
}

export const WorkbenchSplash: FC<WorkbenchSplashProps> = ({
  visible,
  isExiting,
  onExited,
}) => {
  if (!visible) {
    return null;
  }

  return <SplashScreen isExiting={isExiting} onExited={onExited} />;
};
