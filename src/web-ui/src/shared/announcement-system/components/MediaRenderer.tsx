import React, { useEffect, useRef } from 'react';
import type { MediaConfig } from '../types';

interface MediaRendererProps {
  media: MediaConfig;
  active: boolean;
}

interface LottieProps {
  src: string;
  active: boolean;
}

const MEDIA_CLASS = 'announcement-media';
const PLACEHOLDER_CLASS = 'announcement-media__placeholder';
const LOTTIE_PACKAGE = '@lottiefiles/dotlottie-react';

const MediaFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={MEDIA_CLASS}>{children}</div>
);

const MediaPlaceholder: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MediaFrame>
    <div className={PLACEHOLDER_CLASS}>{children}</div>
  </MediaFrame>
);

const LottieRenderer: React.FC<LottieProps> = ({ src, active }) => {
  const [LottieComponent, setLottieComponent] =
    React.useState<React.ComponentType<any> | null>(null);
  const [loadError, setLoadError] = React.useState(false);

  useEffect(() => {
    let cancelled = false;

    import(/* @vite-ignore */ LOTTIE_PACKAGE)
      .then((mod: any) => {
        if (!cancelled) {
          setLottieComponent(() => mod.DotLottieReact ?? mod.default);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <MediaPlaceholder>Lottie library not available</MediaPlaceholder>;
  }

  if (!LottieComponent) {
    return <MediaPlaceholder>Loading...</MediaPlaceholder>;
  }

  return (
    <MediaFrame>
      <LottieComponent
        src={src}
        autoplay={active}
        loop
        style={{ width: '100%', height: '100%' }}
      />
    </MediaFrame>
  );
};

const MediaRenderer: React.FC<MediaRendererProps> = ({ media, active }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (active) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [active]);

  if (media.media_type === 'image' || media.media_type === 'gif') {
    return (
      <MediaFrame>
        <img src={media.src} alt="" draggable={false} />
      </MediaFrame>
    );
  }

  if (media.media_type === 'video') {
    return (
      <MediaFrame>
        <video
          ref={videoRef}
          src={media.src}
          loop
          muted
          playsInline
          autoPlay={active}
        />
      </MediaFrame>
    );
  }

  if (media.media_type === 'lottie') {
    return <LottieRenderer src={media.src} active={active} />;
  }

  return (
    <MediaPlaceholder>
      Unsupported media type: {media.media_type}
    </MediaPlaceholder>
  );
};

export default MediaRenderer;
