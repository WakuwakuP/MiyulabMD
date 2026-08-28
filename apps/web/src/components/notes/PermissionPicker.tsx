import { PERMISSION_PRESETS, type PermissionPreset } from "@miyulabmd/shared";

type Props = {
  value: PermissionPreset;
  disabled?: boolean;
  onChange?: (value: PermissionPreset) => void;
};

export function PermissionPicker({ value, disabled, onChange }: Props) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value as PermissionPreset)}
    >
      {PERMISSION_PRESETS.map((preset) => (
        <option key={preset} value={preset}>
          {preset}
        </option>
      ))}
    </select>
  );
}
