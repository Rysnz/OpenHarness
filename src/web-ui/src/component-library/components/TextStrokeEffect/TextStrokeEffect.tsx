'use client';

import React, { useId } from 'react';
import './TextStrokeEffect.scss';

const CHAR_VIEWBOX_WIDTH = 55;
const VIEWBOX_HEIGHT = 100;
const STROKE_COLORS = ['#eab308', '#ef4444', '#3b82f6', '#06b6d4', '#8b5cf6'];
const GRADIENT_STOPS = ['0%', '25%', '50%', '75%', '100%'];

export interface TextStrokeEffectProps {
  text: string;
  duration?: number;
  className?: string;
  height?: string;
}

export const TextStrokeEffect: React.FC<TextStrokeEffectProps> = ({
  text,
  duration = 4,
  className = '',
  height = '100px',
}) => {
  const gradientId = useId().replace(/:/g, '');
  const viewBoxWidth = text.length * CHAR_VIEWBOX_WIDTH;
  const animationDuration = `${duration}s`;

  return (
    <svg
      className={['text-stroke-effect', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${viewBoxWidth} ${VIEWBOX_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{
        height,
        width: 'auto',
        display: 'block',
      }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          {STROKE_COLORS.map((color, index) => (
            <stop key={color} offset={GRADIENT_STOPS[index]} stopColor={color}>
              <animate
                attributeName="stop-color"
                values={rotatingColorValues(index)}
                dur={animationDuration}
                repeatCount="indefinite"
              />
            </stop>
          ))}
        </linearGradient>
      </defs>

      <StrokeText className="text-stroke-effect__outline" text={text} />
      <StrokeText
        className="text-stroke-effect__animated"
        text={text}
        style={{ animationDuration }}
      />
      <StrokeText
        className="text-stroke-effect__gradient"
        text={text}
        stroke={`url(#${gradientId})`}
      />
    </svg>
  );
};

export default TextStrokeEffect;

interface StrokeTextProps {
  className: string;
  text: string;
  stroke?: string;
  style?: React.CSSProperties;
}

const StrokeText: React.FC<StrokeTextProps> = ({ className, text, stroke, style }) => (
  <text
    x="50%"
    y="55%"
    textAnchor="middle"
    dominantBaseline="middle"
    className={className}
    stroke={stroke}
    style={style}
  >
    {text}
  </text>
);

function rotatingColorValues(startIndex: number): string {
  const colors = [
    ...STROKE_COLORS.slice(startIndex),
    ...STROKE_COLORS.slice(0, startIndex),
    STROKE_COLORS[startIndex],
  ];
  return colors.join('; ');
}
