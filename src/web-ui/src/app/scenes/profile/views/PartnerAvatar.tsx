import React from 'react';
import { Sparkles } from 'lucide-react';

interface PartnerAvatarProps {
  name?: string;
  imageSrc?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function getInitial(name?: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return 'O';
  return Array.from(trimmed)[0]?.toUpperCase() || 'O';
}

const PartnerAvatar: React.FC<PartnerAvatarProps> = ({
  name,
  imageSrc,
  size = 'md',
  className = '',
}) => {
  const safeImage = imageSrc?.trim();
  const classes = [
    'partner-avatar',
    `partner-avatar--${size}`,
    safeImage ? 'partner-avatar--image' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={classes} aria-hidden="true">
      {safeImage ? (
        <img className="partner-avatar__image" src={safeImage} alt="" />
      ) : (
        <>
          <span className="partner-avatar__mesh" />
          <span className="partner-avatar__node partner-avatar__node--a" />
          <span className="partner-avatar__node partner-avatar__node--b" />
          <span className="partner-avatar__initial">{getInitial(name)}</span>
          <Sparkles className="partner-avatar__spark" size={12} strokeWidth={1.8} />
        </>
      )}
    </span>
  );
};

export default PartnerAvatar;
