// Pure pricing engine. All money is integer cents.

export const REGIONS = ['CA', 'NY', 'TX', 'OR', 'WA', 'AK', 'HI', 'FL'] as const;
export type Region = (typeof REGIONS)[number];

const TAX_RATE: Record<Region, number> = { CA: 0.085, NY: 0.08875, TX: 0.0625, OR: 0, WA: 0.065, AK: 0, HI: 0.04, FL: 0.06 };
const REMOTE: Region[] = ['AK', 'HI']; // +$10 shipping surcharge
const FREE_SHIPPING_THRESHOLD = 7500;
const BASE_SHIPPING = 599;
const REMOTE_SURCHARGE = 1000;
const MAX_COUPON_SHARE = 0.5; // a coupon can never take more than 50% off

export interface Coupon {
  code: string;
  kind: 'percent' | 'flat' | 'freeship';
  value: number; // percent points, or cents for flat
  minSubtotal: number; // cents, measured on promo-eligible subtotal after tier discounts
  category?: string; // percent coupons restricted to a category
}

export const COUPONS: Record<string, Coupon> = {
  SAVE10: { code: 'SAVE10', kind: 'percent', value: 10, minSubtotal: 5000 },
  SAVE25: { code: 'SAVE25', kind: 'percent', value: 25, minSubtotal: 20000 },
  SHOES15: { code: 'SHOES15', kind: 'percent', value: 15, minSubtotal: 0, category: 'shoes' },
  FLAT20: { code: 'FLAT20', kind: 'flat', value: 2000, minSubtotal: 10000 },
  FREESHIP: { code: 'FREESHIP', kind: 'freeship', value: 0, minSubtotal: 3000 },
};

// Only one percent/flat coupon at a time; FREESHIP stacks with it.
export const isDiscountCoupon = (c: Coupon) => c.kind !== 'freeship';

export interface LineInput {
  productId: string;
  name: string;
  category: string;
  unitPrice: number;
  qty: number;
}

export interface PricedLine extends LineInput {
  gross: number;
  tierDiscount: number;
  net: number;
}

export interface Priced {
  lines: PricedLine[];
  subtotal: number; // sum of gross
  tierDiscount: number;
  subtotalAfterTier: number;
  coupons: { code: string; discount: number }[];
  droppedCoupons: { code: string; reason: string }[];
  couponDiscount: number;
  freeShippingApplied: boolean;
  shipping: number;
  taxable: number;
  tax: number;
  total: number;
}

const roundHalfUp = (x: number) => Math.floor(x + 0.5);

// Bulk tiers: 10+ units 10% off the line, 50+ units 20%. Gift cards never discount.
export function tierRate(qty: number, category: string): number {
  if (category === 'gift-card') return 0;
  return qty >= 50 ? 0.2 : qty >= 10 ? 0.1 : 0;
}

export function priceCart(input: LineInput[], couponCodes: string[], region: Region): Priced {
  const lines: PricedLine[] = input.map((l) => {
    const gross = l.unitPrice * l.qty;
    const tierDiscount = roundHalfUp(gross * tierRate(l.qty, l.category));
    return { ...l, gross, tierDiscount, net: gross - tierDiscount };
  });
  const subtotal = lines.reduce((n, l) => n + l.gross, 0);
  const tierDiscount = lines.reduce((n, l) => n + l.tierDiscount, 0);
  const subtotalAfterTier = subtotal - tierDiscount;

  // Gift cards don't count towards promotions, shipping or tax.
  const eligible = lines.filter((l) => l.category !== 'gift-card');
  const eligibleNet = eligible.reduce((n, l) => n + l.net, 0);
  const shippable = eligible.length > 0;

  const applied: { code: string; discount: number }[] = [];
  const dropped: { code: string; reason: string }[] = [];
  let couponDiscount = 0;
  let freeShip = false;
  const cap = Math.floor(eligibleNet * MAX_COUPON_SHARE);

  for (const code of couponCodes) {
    const c = COUPONS[code];
    if (!c) { dropped.push({ code, reason: 'unknown coupon' }); continue; }
    if (eligibleNet < c.minSubtotal) { dropped.push({ code, reason: `minimum spend ${c.minSubtotal / 100} not met` }); continue; }
    if (c.kind === 'freeship') {
      if (!shippable) { dropped.push({ code, reason: 'nothing to ship' }); continue; }
      freeShip = true;
      applied.push({ code, discount: 0 });
      continue;
    }
    const base = c.category ? eligible.filter((l) => l.category === c.category).reduce((n, l) => n + l.net, 0) : eligibleNet;
    if (base === 0) { dropped.push({ code, reason: `no ${c.category} items in cart` }); continue; }
    let d = c.kind === 'percent' ? roundHalfUp((base * c.value) / 100) : Math.min(c.value, base);
    d = Math.min(d, cap - couponDiscount); // enforce the 50% cap
    couponDiscount += d;
    applied.push({ code, discount: d });
  }

  let shipping = 0;
  if (shippable && !freeShip) {
    const base = eligibleNet - couponDiscount >= FREE_SHIPPING_THRESHOLD ? 0 : BASE_SHIPPING;
    shipping = base + (REMOTE.includes(region) ? REMOTE_SURCHARGE : 0);
  }

  // NY taxes shipping; everywhere else shipping is untaxed.
  const taxable = eligibleNet - couponDiscount + (region === 'NY' ? shipping : 0);
  const tax = roundHalfUp(taxable * TAX_RATE[region]);
  const total = subtotalAfterTier - couponDiscount + shipping + tax;

  return { lines, subtotal, tierDiscount, subtotalAfterTier, coupons: applied, droppedCoupons: dropped, couponDiscount, freeShippingApplied: freeShip, shipping, taxable, tax, total };
}
