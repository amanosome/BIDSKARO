import React from 'react';

export const BidsKaroLogo: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const iconDim = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-11 h-11' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-2xl' : 'text-xl';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg className={iconDim} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#0D1526" />
        <rect x="2" y="2" width="60" height="60" rx="12" stroke="#10B981" strokeOpacity="0.4" strokeWidth="2" />
        <path
          d="M32 10L50 18V31C50 43 42 51 32 55C22 51 14 43 14 31V18L32 10Z"
          fill="#060B18"
          stroke="#F59E0B"
          strokeWidth="2.5"
        />
        <g transform="rotate(-32 32 30)">
          <rect x="24" y="21" width="16" height="8" rx="2" fill="#F59E0B" />
          <rect x="30.5" y="29" width="3" height="16" rx="1.5" fill="#10B981" />
        </g>
        <rect x="21" y="43" width="22" height="3" rx="1.5" fill="#10B981" />
      </svg>
      <span className={`font-display font-extrabold tracking-tight text-white ${textSize}`}>
        BIDS<span className="text-emerald-400">KARO</span>
      </span>
    </span>
  );
};

export const TeamCrest: React.FC<{
  shortCode: string;
  primaryColor: string;
  secondaryColor?: string;
  size?: 'sm' | 'md' | 'lg';
}> = ({ shortCode, primaryColor, secondaryColor = '#F59E0B', size = 'md' }) => {
  const dims =
    size === 'sm'
      ? 'w-8 h-8 text-[11px]'
      : size === 'lg'
        ? 'w-14 h-14 text-base'
        : 'w-10 h-10 text-xs';

  return (
    <div
      className={`${dims} rounded-lg flex items-center justify-center font-display font-extrabold tracking-tight text-white shrink-0 border shadow-sm`}
      style={{
        background: `linear-gradient(135deg, ${primaryColor} 0%, #0B1221 100%)`,
        borderColor: secondaryColor,
      }}
    >
      {shortCode}
    </div>
  );
};
