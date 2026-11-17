import { Delete } from 'lucide-react';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onBackspace?: () => void;
  maxLength?: number;
  disabled?: boolean;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"];

export function PinPad({
  value,
  onChange,
  onBackspace,
  maxLength = 12,
  disabled = false,
}: Props) {
  const append = (digit: string) => {
    if (!disabled && value.length < maxLength) onChange(value + digit);
  };

  return (
    <div className="hc-pinpad" aria-label="Цифровая клавиатура PIN-кода">
      <div className="hc-pinpad__keys">
        {KEYS.map((key, index) => {
          if (key === "") return <span key={`spacer-${index}`} aria-hidden="true" />;
          if (key === "backspace") {
            return (
              <button
                key={key}
                type="button"
                className="hc-pinpad__key hc-pinpad__key--utility"
                disabled={disabled || value.length === 0}
                aria-label="Удалить последнюю цифру"
                onClick={() => onBackspace ? onBackspace() : onChange(value.slice(0, -1))}
              >
                <Delete size={25} strokeWidth={1.8} aria-hidden="true" />
              </button>
            );
          }
          return (
            <button
              key={key}
              type="button"
              className="hc-pinpad__key"
              disabled={disabled || value.length >= maxLength}
              aria-label={`Цифра ${key}`}
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
