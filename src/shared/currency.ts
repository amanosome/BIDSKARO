import { CurrencyCode } from './auctionTypes';

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  INR: '₹',
  USD: '$',
  GBP: '£',
  AUD: 'A$',
  AED: 'AED ',
};

// Conversion relative to INR base units for display when host switches currency
const CURRENCY_RATE_FROM_INR: Record<CurrencyCode, number> = {
  INR: 1,
  USD: 0.012,
  GBP: 0.0095,
  AUD: 0.018,
  AED: 0.044,
};

export const CRORE = 10_000_000;
export const LAKH = 100_000;

export function formatIndianCommas(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function formatCurrency(
  amountInInr: number,
  currency: CurrencyCode = 'INR',
  options: { compact?: boolean; decimals?: number } = {}
): string {
  const { compact = true, decimals } = options;
  const symbol = CURRENCY_SYMBOLS[currency] || '₹';

  if (currency !== 'INR') {
    const converted = amountInInr * (CURRENCY_RATE_FROM_INR[currency] || 1);
    if (compact) {
      if (converted >= 1_000_000) {
        return `${symbol}${(converted / 1_000_000).toFixed(decimals ?? 2)}M`;
      }
      if (converted >= 1_000) {
        return `${symbol}${(converted / 1_000).toFixed(decimals ?? 0)}K`;
      }
    }
    return `${symbol}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(converted))}`;
  }

  if (!compact) {
    return `${symbol}${formatIndianCommas(amountInInr)}`;
  }

  const abs = Math.abs(amountInInr);
  const sign = amountInInr < 0 ? '-' : '';

  if (abs === 0) return `${symbol}0`;

  if (abs >= CRORE) {
    const crores = abs / CRORE;
    const isWhole = Math.abs(crores - Math.round(crores)) < 0.001;
    const formatted = isWhole
      ? String(Math.round(crores))
      : crores.toFixed(decimals ?? 2).replace(/\.?0+$/, '');
    return `${sign}${symbol}${formatted} Crore`;
  }

  if (abs >= LAKH) {
    const lakhs = abs / LAKH;
    const isWhole = Math.abs(lakhs - Math.round(lakhs)) < 0.001;
    const formatted = isWhole
      ? String(Math.round(lakhs))
      : lakhs.toFixed(decimals ?? 1).replace(/\.0$/, '');
    return `${sign}${symbol}${formatted} ${Math.abs(lakhs - 1) < 0.01 ? 'Lakh' : 'Lakhs'}`;
  }

  return `${sign}${symbol}${formatIndianCommas(abs)}`;
}

export function formatShortCurrency(amountInInr: number, currency: CurrencyCode = 'INR'): string {
  if (currency !== 'INR') {
    return formatCurrency(amountInInr, currency, { compact: true });
  }
  const abs = Math.abs(amountInInr);
  const sign = amountInInr < 0 ? '-' : '';
  if (abs === 0) return '₹0';
  if (abs >= CRORE) {
    const crores = abs / CRORE;
    const isWhole = Math.abs(crores - Math.round(crores)) < 0.001;
    return `${sign}₹${isWhole ? Math.round(crores) : crores.toFixed(2).replace(/\.?0+$/, '')} Cr`;
  }
  if (abs >= LAKH) {
    const lakhs = abs / LAKH;
    const isWhole = Math.abs(lakhs - Math.round(lakhs)) < 0.001;
    return `${sign}₹${isWhole ? Math.round(lakhs) : lakhs.toFixed(1).replace(/\.0$/, '')} L`;
  }
  return `${sign}₹${formatIndianCommas(abs)}`;
}

/**
 * Parses flexible custom bid entries such as:
 * "27500000", "2,75,00,000", "₹2,75,00,000", "2.75 Cr", "2.75 Crore", "75 L", "75 Lakhs"
 */
export function parseCustomBidInput(raw: string): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[₹$£,\s]/g, '').toLowerCase();
  if (!cleaned) return null;

  const croreMatch = cleaned.match(/^(\d+(?:\.\d+)?)(cr|crore|crores)$/);
  if (croreMatch) {
    const num = parseFloat(croreMatch[1]);
    return Number.isFinite(num) ? Math.round(num * CRORE) : null;
  }

  const lakhMatch = cleaned.match(/^(\d+(?:\.\d+)?)(l|lac|lakh|lakhs)$/);
  if (lakhMatch) {
    const num = parseFloat(lakhMatch[1]);
    return Number.isFinite(num) ? Math.round(num * LAKH) : null;
  }

  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    const num = Number(cleaned);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
  }

  return null;
}
