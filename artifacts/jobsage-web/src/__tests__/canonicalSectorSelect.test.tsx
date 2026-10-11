import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { CanonicalSectorSelect } from "@/components/forms/CanonicalSectorSelect";
import { CANONICAL_SECTOR_OPTIONS } from "@workspace/api-zod/sector-catalog";

describe("CanonicalSectorSelect", () => {
  it("exposes all eight canonical sectors through a labelled keyboard-focusable select", () => {
    const onChange = vi.fn();
    render(
      <CanonicalSectorSelect
        id="sector"
        label="Professional sector"
        value=""
        onChange={onChange}
        required
      />,
    );

    const select = screen.getByRole("combobox", { name: /Professional sector/ });
    expect(select).toHaveAttribute("aria-required", "true");
    expect(select).toHaveAttribute("required");
    expect(select).toHaveAccessibleName(/Professional sector/);
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.text)).toEqual([
      "Select sector...",
      ...CANONICAL_SECTOR_OPTIONS.map((option) => option.label),
    ]);

    select.focus();
    expect(select).toHaveFocus();
    fireEvent.change(select, { target: { value: "legal" } });
    expect(onChange).toHaveBeenCalledWith("legal");
  });
});
