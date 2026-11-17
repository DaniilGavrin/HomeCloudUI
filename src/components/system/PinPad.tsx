type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export function PinPad({ value, onChange, disabled = false }: Props) {
  const append = (digit: string) => {
    if (!disabled && value.length < 12) onChange(value + digit);
  };

  return (
    <div className="hc-pinpad" aria-label="Цифровая клавиатура PIN-кода">
      <div className="hc-pinpad__keys">
        {KEYS.map((key) => {
          const inert = key === "*" || key === "#";
          return (
            <button
              key={key}
              type="button"
              className={`hc-pinpad__key ${inert ? "is-inert" : ""}`}
              disabled={disabled || inert}
              aria-label={inert ? undefined : `Цифра ${key}`}
              tabIndex={inert ? -1 : 0}
              onClick={() => append(key)}
            >
              {key}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="hc-pinpad__clear"
        disabled={disabled || value.length === 0}
        onClick={() => onChange("")}
      >
        Очистить ввод
      </button>
    </div>
  );
}
