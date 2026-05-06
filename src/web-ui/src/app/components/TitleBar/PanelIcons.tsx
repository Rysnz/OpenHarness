import React from 'react';

interface IconProps {
  size?: number;
  filled?: boolean;
  className?: string;
}

interface PanelIconSpec {
  dividerX: number[];
  fill?: {
    x: number;
    width: number;
  };
}

const PANEL_ICON_SPECS = {
  left: {
    dividerX: [9],
    fill: { x: 4, width: 4.5 }
  },
  right: {
    dividerX: [15],
    fill: { x: 15.5, width: 4.5 }
  },
  center: {
    dividerX: [9, 15],
    fill: { x: 9.5, width: 5 }
  }
} satisfies Record<'left' | 'right' | 'center', PanelIconSpec>;

const PanelIcon: React.FC<IconProps & { spec: PanelIconSpec }> = ({
  size = 14,
  filled = false,
  className = '',
  spec
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    {spec.dividerX.map((x) => (
      <line key={x} x1={x} y1="3" x2={x} y2="21" />
    ))}
    {filled && spec.fill && (
      <rect
        x={spec.fill.x}
        y="4"
        width={spec.fill.width}
        height="16"
        rx="1"
        fill="currentColor"
        fillOpacity="0.4"
        stroke="none"
      />
    )}
  </svg>
);

export const PanelLeftIcon: React.FC<IconProps> = (props) => (
  <PanelIcon {...props} spec={PANEL_ICON_SPECS.left} />
);

export const PanelRightIcon: React.FC<IconProps> = (props) => (
  <PanelIcon {...props} spec={PANEL_ICON_SPECS.right} />
);

export const PanelCenterIcon: React.FC<IconProps> = (props) => (
  <PanelIcon {...props} spec={PANEL_ICON_SPECS.center} />
);
