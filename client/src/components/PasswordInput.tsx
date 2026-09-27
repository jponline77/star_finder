import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  className?: string;
}

/** Password field with a show/hide toggle (keeps focus in the input). */
export function PasswordInput({ className = '', ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`input-group ${className}`.trim()}>
      <input {...rest} type={visible ? 'text' : 'password'} className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button
        type="button"
        className="btn-icon btn-icon-sm input-addon"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
