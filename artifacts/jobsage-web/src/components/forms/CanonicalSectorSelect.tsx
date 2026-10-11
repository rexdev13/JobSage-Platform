import { Label, Select } from "@/components/ui-enhanced";
import { CANONICAL_SECTOR_OPTIONS, type CanonicalSector } from "@workspace/api-zod/sector-catalog";

interface CanonicalSectorSelectProps {
  id: string;
  value: CanonicalSector | "";
  onChange: (value: CanonicalSector | "") => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}

/** Shared, accessible sector selector backed by the API's canonical catalogue. */
export function CanonicalSectorSelect({
  id,
  value,
  onChange,
  label = "Sector",
  required = false,
  disabled = false,
}: CanonicalSectorSelectProps) {
  return (
    <div>
      <Label htmlFor={id}>
        {label}{required && <span className="text-destructive"> *</span>}
      </Label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as CanonicalSector | "")}
        required={required}
        disabled={disabled}
        aria-required={required}
      >
        <option value="">Select sector...</option>
        {CANONICAL_SECTOR_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    </div>
  );
}
