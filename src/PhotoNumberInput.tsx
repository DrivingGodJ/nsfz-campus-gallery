import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'onBlur'> & {
  value?: number; allowEmpty?: boolean; onValue: (value: number | undefined) => void;
};
const display = (value?: number) => value === undefined ? '' : String(Number(value.toFixed(1)));

// Keep unfinished input (a minus sign, decimal point or cleared field) local.
// Only valid numbers update the camera; dragging it can still update this field.
export default function PhotoNumberInput({ value, allowEmpty = false, onValue, min, max, ...props }: Props) {
  const edited = useRef(false);
  const [text, setText] = useState(() => display(value));
  useEffect(() => {
    setText(current => current !== '' && Number(current) === value ? current : display(value));
  }, [value]);
  const bounded = (number: number) => Math.max(min === undefined ? -Infinity : Number(min), Math.min(max === undefined ? Infinity : Number(max), number));
  return <input {...props} type="number" min={min} max={max} value={text} onChange={event => {
    edited.current = true;
    const next = event.target.value;
    setText(next);
    if (next === '') { if (allowEmpty) onValue(undefined); return; }
    const number = Number(next);
    if (Number.isFinite(number) && bounded(number) === number) onValue(number);
  }} onBlur={() => {
    if (!edited.current) { setText(display(value)); return; }
    edited.current = false;
    if (text !== '' && Number.isFinite(Number(text))) {
      const number = bounded(Number(text));
      if (number !== value) onValue(number);
      setText(display(number));
    } else setText(display(value));
  }} />;
}
