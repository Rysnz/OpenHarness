import React from 'react';
import type { ChatInputPetMood } from '../utils/chatInputPetMood';
import './ChatInputPixelPet.scss';

export interface ChatInputPixelPetProps {
  mood: ChatInputPetMood;
  className?: string;
  layout?: 'center' | 'stopRight';
}

const MOODS: ChatInputPetMood[] = ['rest', 'analyzing', 'waiting', 'working'];

function StatusGlyph({ mood }: { mood: ChatInputPetMood }) {
  return (
    <svg
      className={`openharness-chat-input-pixel-pet__svg openharness-chat-input-pixel-pet__svg--${mood}`}
      viewBox="0 0 44 36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g className={`openharness-core-glyph openharness-core-glyph--${mood}`}>
        <rect className="openharness-core-glyph__plate" x="8" y="4" width="28" height="28" rx="8" />
        <path className="openharness-core-glyph__orbit openharness-core-glyph__orbit--outer" d="M12 18c4.5-8 15.5-8 20 0-4.5 8-15.5 8-20 0Z" />
        <path className="openharness-core-glyph__orbit openharness-core-glyph__orbit--inner" d="M16 18c2.4-4.2 9.6-4.2 12 0-2.4 4.2-9.6 4.2-12 0Z" />
        <circle className="openharness-core-glyph__node openharness-core-glyph__node--left" cx="15" cy="18" r="2.2" />
        <circle className="openharness-core-glyph__node openharness-core-glyph__node--center" cx="22" cy="18" r="2.8" />
        <circle className="openharness-core-glyph__node openharness-core-glyph__node--right" cx="29" cy="18" r="2.2" />
        <path className="openharness-core-glyph__scan" d="M9 27h26" />
        <path className="openharness-core-glyph__spark openharness-core-glyph__spark--a" d="M7 10h4M9 8v4" />
        <path className="openharness-core-glyph__spark openharness-core-glyph__spark--b" d="M33 8h4M35 6v4" />
      </g>
    </svg>
  );
}

export const ChatInputPixelPet: React.FC<ChatInputPixelPetProps> = ({
  mood,
  className = '',
  layout = 'center',
}) => {
  const layoutMod =
    layout === 'stopRight' ? ' openharness-chat-input-pixel-pet--layout-stop-right' : '';
  return (
    <div className={`openharness-chat-input-pixel-pet${layoutMod} ${className}`.trim()} aria-hidden>
      {MOODS.map(m => (
        <div
          key={m}
          className="openharness-chat-input-pixel-pet__layer"
          data-active={m === mood ? 'true' : 'false'}
        >
          <StatusGlyph mood={m} />
        </div>
      ))}
    </div>
  );
};
