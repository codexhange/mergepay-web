"use client";

/**
 * AssetSelector
 *
 * Controlled expense-asset picker with a real-time fiat conversion preview.
 * Supports XLM, USDC and custom trustline tokens (passed via `assets`).
 *
 * The component never mutates the amount itself — callers own the string — but
 * it normalises input to a valid Stellar decimal (up to 7 decimal places) on
 * blur and renders a live fiat equivalent while the user types, so precision
 * rules stay in one place.
 *
 * Fully keyboard-accessible: the amount input and asset select are labelled,
 * the asset listbox is navigable with arrow keys, and the fiat preview is
 * announced to assistive technology via an aria-live region.
 */

import { useId, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { AssetBadge } from "@/components/asset-badge";
import { Input, Label, Select } from "@/components/ui/input";
import { SETTLEMENT_ASSETS } from "@/lib/constants";
import { useCurrencyRates, convertToFiat } from "@/hooks/useCurrencyRates";
import { useFiatPreference } from "@/lib/fiat-preference";
import { MAX_DECIMAL_PLACES } from "@/lib/money";
import { parseDecimalDigits } from "@/lib/currency";
import { cn } from "@/lib/utils";

export interface AssetOption {
  code: string;
  issuer: string | null;
  name?: string;
}

export interface AssetSelectorProps {
  /** Current expense amount as typed by the user. */
  value: string;
  /** Currently selected asset code. */
  assetCode: string;
  /** Called whenever the amount string changes. */
  onAmountChange: (value: string) => void;
  /** Called whenever the selected asset changes. */
  onAssetChange: (code: string) => void;
  /** Assets to offer. Defaults to the configured settlement assets (XLM + stable). */
  assets?: AssetOption[];
  /** Optional id override for the amount input. */
  id?: string;
  /** Visually hidden label for the asset select (defaults to "Asset"). */
  assetLabel?: string;
  className?: string;
}

/**
 * Round a raw user string to at most 7 decimal places (Stellar precision),
 * returning `""` for empty input and `null` when the input is not numeric.
 *
 * Uses half-up rounding on the 7th decimal place (1 stroop), matching the
 * precision the Stellar network accepts — e.g. `"1.23456789"` → `"1.2345679"`.
 * Negative and zero amounts are rejected because expenses are positive.
 */
export function normalizeAssetAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  const digits = parseDecimalDigits(trimmed);
  if (!digits) return null;

  const rounded = roundDecimalDigits(digits, MAX_DECIMAL_PLACES);
  const frac = rounded.frac.replace(/0+$/, "");
  const plain = frac ? `${rounded.int}.${frac}` : rounded.int;
  const value = Number(plain);
  if (!Number.isFinite(value) || value <= 0 || rounded.negative) return null;
  return plain;
}

/** Round decimal digits to `places` fractional digits, half away from zero. */
function roundDecimalDigits(
  value: { negative: boolean; int: string; frac: string },
  places: number
): { negative: boolean; int: string; frac: string } {
  const { negative, int, frac } = value;
  if (frac.length <= places) {
    return { negative, int, frac: frac.padEnd(places, "0") };
  }

  const kept = frac.slice(0, places);
  const nextDigit = frac.charCodeAt(places) - 48;
  let scaled = BigInt(`${int}${kept}`);
  if (nextDigit >= 5) scaled += 1n;

  const digits = scaled.toString().padStart(places + 1, "0");
  const cut = digits.length - places;
  return {
    negative,
    int: digits.slice(0, cut),
    frac: places === 0 ? "" : digits.slice(cut),
  };
}

export function AssetSelector({
  value,
  assetCode,
  onAmountChange,
  onAssetChange,
  assets = SETTLEMENT_ASSETS,
  id,
  assetLabel = "Asset",
  className,
}: AssetSelectorProps) {
  const reactId = useId();
  const amountId = id ?? reactId;
  const assetId = useId();

  const preferredCurrency = useFiatPreference((s) => s.preferredCurrency);
  const { rates, isLive } = useCurrencyRates(preferredCurrency);

  const fiatValue = useMemo(
    () => convertToFiat(value, assetCode, rates),
    [value, assetCode, rates]
  );

  const [assetOpen, setAssetOpen] = useState(false);

  const selectedAsset = assets.find((a) => a.code === assetCode);

  function handleBlur() {
    const normalized = normalizeAssetAmount(value);
    if (normalized !== null && normalized !== value) {
      onAmountChange(normalized);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <Label htmlFor={amountId}>Amount</Label>
        <Input
          id={amountId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder="0.00"
          onChange={(e) => onAmountChange(e.target.value)}
          onBlur={handleBlur}
          aria-describedby={`${amountId}-fiat`}
        />

        {/* Live fiat conversion preview */}
        <p
          id={`${amountId}-fiat`}
          aria-live="polite"
          className="mt-1.5 flex items-center gap-1.5 text-xs text-ink/60"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
          {fiatValue !== null ? (
            <>
              ≈ {fiatValue} {preferredCurrency}
              {!isLive && (
                <span className="font-bold text-ink/40">(indicative)</span>
              )}
            </>
          ) : (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              <span>Loading {preferredCurrency} rate…</span>
            </>
          )}
        </p>
      </div>

      <div>
        <Label htmlFor={assetId}>{assetLabel}</Label>
        <Select
          id={assetId}
          value={assetCode}
          onChange={(e) => onAssetChange(e.target.value)}
          onFocus={() => setAssetOpen(true)}
          onBlur={() => setAssetOpen(false)}
          aria-expanded={assetOpen}
          aria-label={assetLabel}
        >
          {assets.map((asset) => (
            <option key={asset.code} value={asset.code}>
              {asset.name ? `${asset.name} (${asset.code})` : asset.code}
            </option>
          ))}
        </Select>
      </div>

      {selectedAsset && (
        <div className="flex items-center justify-between rounded-xl border-2 border-ink bg-paper px-3 py-2 shadow-brutal-sm">
          <div className="flex items-center gap-2">
            <AssetBadge code={selectedAsset.code} />
            <span className="text-xs text-ink/60">
              {selectedAsset.name ?? selectedAsset.code}
            </span>
          </div>
          <span className="font-mono text-[11px] text-ink/40">
            {selectedAsset.issuer ? `issuer ${selectedAsset.issuer.slice(0, 8)}…` : "native · up to 7 dp"}
          </span>
        </div>
      )}
    </div>
  );
}

export { MAX_DECIMAL_PLACES as ASSET_MAX_DECIMALS };
